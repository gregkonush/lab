'use client'

import { useRef } from 'react'
import Editor from '@monaco-editor/react'

interface EditorProps {
  code: string
  onCodeChange: (value: string) => void
  language: string
  onExecute?: (currentCode: string) => void
}

const EDITOR_THEME = 'custom-dark'

const typescriptCompilerOptions = {
  target: 99, // ESNext
  allowNonTsExtensions: true,
  moduleResolution: 2, // NodeJs
  module: 1, // CommonJS
  noEmit: true,
  esModuleInterop: true,
  jsx: 2, // React
  reactNamespace: 'React',
  allowJs: true,
  typeRoots: ['node_modules/@types'],
}

export default function EditorComponent({ code, onCodeChange, language, onExecute }: EditorProps) {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)

  const handleEditorWillMount = (monaco: any) => {
    monaco.editor.defineTheme(EDITOR_THEME, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1E1E1E',
      },
    })
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(typescriptCompilerOptions)
  }

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Register Cmd + Enter keybinding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (onExecute && editorRef.current) {
        const currentCode = editorRef.current.getValue()
        onExecute(currentCode)
      }
    })
  }

  return (
    <div className="rounded-lg h-[500px] overflow-hidden">
      <Editor
        value={code}
        language={language}
        theme={EDITOR_THEME}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        options={{
          automaticLayout: true,
          fontSize: 14,
          fontFamily: 'var(--font-jetbrains-mono)',
          fontLigatures: true,
          fontWeight: '300',
          padding: { top: 18 },
          minimap: { enabled: false },
          tabSize: 2,
          insertSpaces: true,
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: 'auto',
            verticalScrollbarSize: 10,
            verticalSliderSize: 10,
          },
          overviewRulerLanes: 0,
          lineNumbersMinChars: 3,
          lineDecorationsWidth: 0,
          glyphMargin: false,
          fixedOverflowWidgets: true,
        }}
        onChange={(value) => onCodeChange(value ?? '')}
      />
    </div>
  )
}
