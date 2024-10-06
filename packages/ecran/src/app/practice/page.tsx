'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Editor from '@/components/editor'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const defaultJavaCode = `
public String greet(String name) {
    return "Hello, " + name + "!";
}
System.out.println(greet("World"));
`.trim()

const defaultTypeScriptCode = `
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`.trim()

const defaultJavaScriptCode = `
function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`.trim()

const defaultPythonCode = `
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
`.trim()

function LoadingDots() {
  return (
    <div className="flex items-center justify-center space-x-1 min-h-6">
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.span
        className="w-2 h-2 bg-current rounded-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut', delay: 0.4 }}
      />
    </div>
  )
}

export default function PracticePage() {
  const [code, setCode] = useState(defaultJavaCode)
  const [language, setLanguage] = useState('java')
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const handleCodeChange = (value: string) => {
    setCode(value)
  }

  const handleLanguageChange = (value: string) => {
    setLanguage(value)
    setCode(getDefaultCode(value))
  }

  const getDefaultCode = (language: string) => {
    switch (language) {
      case 'java':
        return defaultJavaCode
      case 'typescript':
        return defaultTypeScriptCode
      case 'javascript':
        return defaultJavaScriptCode
      case 'python':
        return defaultPythonCode
      default:
        return ''
    }
  }

  const handleExecuteCode = useCallback(
    async (currentCode?: string) => {
      setIsLoading(true)
      setOutput('')
      try {
        const codeToExecute = currentCode ?? code
        const response = await fetch('/api/executions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: codeToExecute, language }),
        })
        if (!response.body) {
          throw new Error('ReadableStream not supported.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let done = false

        while (!done) {
          const { value, done: doneReading } = await reader.read()
          done = doneReading
          if (value) {
            const chunk = decoder.decode(value)
            setOutput((prevOutput) => prevOutput + chunk)
          }
        }
      } catch (error) {
        console.error('Execution error:', error)
        setOutput('An error occurred while executing the code.')
      } finally {
        setIsLoading(false)
      }
    },
    [code, language],
  )

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold">Practice</h1>
        <div className="flex items-end justify-between">
          <motion.div
            whileTap={{ scale: isLoading ? 1 : 0.975 }}
            onHoverStart={() => setIsHovered(true)}
            onHoverEnd={() => setIsHovered(false)}
            tabIndex={-1}
            className={cn(isLoading && 'opacity-50 cursor-not-allowed')}
          >
            <Button
              onClick={() => handleExecuteCode()}
              disabled={isLoading}
              className={cn(
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-400',
                'rounded py-1 px-4 bg-indigo-600 text-zinc-200',
                'hover:bg-zinc-200 hover:text-indigo-600 ',
                'transition-all duration-300 flex items-center justify-center',
                'text-center min-w-24 ring-1 ring-zinc-900 h-10 border border-indigo-400',
                'shadow-dark-sm',
              )}
            >
              {isLoading ? <LoadingDots /> : isHovered ? '|>' : 'Run'}
            </Button>
          </motion.div>
          <div className="space-y-2 flex flex-row items-center">
            <label className="mr-4 font-semibold text-sm pt-1.5" htmlFor="language-select">
              Language
            </label>
            <Select value={language} onValueChange={handleLanguageChange} name="language-select">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="java">Java</SelectItem>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Editor code={code} onCodeChange={handleCodeChange} language={language} onExecute={handleExecuteCode} />
        </div>

        <div
          className={cn([
            'border border-zinc-900 rounded-md p-4 space-y-2 min-h-40',
            output.toLowerCase().includes('error') || output.toLowerCase().includes('exception')
              ? 'bg-red-800 text-red-100'
              : 'bg-zinc-900 text-zinc-100',
          ])}
        >
          {isLoading ? (
            <p className="text-muted-foreground">Executing code...</p>
          ) : output ? (
            <pre className={cn(['rounded-md w-full overflow-x-auto text-sm'])}>{output}</pre>
          ) : (
            <p className="text-muted-foreground">Click execute to see the output.</p>
          )}
        </div>
      </div>
    </div>
  )
}
