'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import Editor from '@/components/editor'

const defaultJavaCode = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
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

export default function PracticePage() {
  const [code, setCode] = useState(defaultJavaCode)
  const [language, setLanguage] = useState('java')
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

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
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold mb-6">Code Practice</h1>
        <div className="flex items-center mb-4">
          <label className="mr-2 font-semibold">Language:</label>
          <Select value={language} onValueChange={handleLanguageChange}>
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
        <div>
          <Editor code={code} onCodeChange={handleCodeChange} language={language} onExecute={handleExecuteCode} />
        </div>
        <Button onClick={() => handleExecuteCode()} disabled={isLoading} className="mb-4">
          {isLoading ? 'Executing...' : 'Execute'}
        </Button>
        <Card className="-p-2">
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Executing code...</p>
            ) : output ? (
              <pre
                className={`p-4 rounded-md w-full overflow-x-auto text-sm ${
                  output.toLowerCase().includes('error') || output.toLowerCase().includes('exception')
                    ? 'bg-red-800 text-red-100'
                    : 'bg-zinc-900 text-zinc-100'
                }`}
              >
                {output}
              </pre>
            ) : (
              <p className="text-muted-foreground">Click execute to see the output.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
