'use client'
import { useCallback, useEffect, useRef } from 'react'
import loader from '@monaco-editor/loader'
import { editor } from 'monaco-editor'

const EDITOR_THEME = 'custom-dark'

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  value: 'console.log("Hello world!");',
  language: 'typescript',
  automaticLayout: true,
  theme: EDITOR_THEME,
  fontSize: 16,
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
}

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

export default function Editor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const initializeEditor = useCallback(async () => {
    const monaco = await loader.init()

    editorInstanceRef.current = monaco.editor.create(editorRef.current!, editorOptions)

    defineCustomTheme(monaco)
    setTypescriptCompilerOptions(monaco)
    addResizeListener()
  }, [])

  useEffect(() => {
    if (editorRef.current && !editorInstanceRef.current) {
      initializeEditor()
    }

    return () => {
      if (editorInstanceRef.current) {
        editorInstanceRef.current.dispose()
        editorInstanceRef.current = null
      }
    }
  }, [initializeEditor])

  const defineCustomTheme = (monaco: any) => {
    monaco.editor.defineTheme(EDITOR_THEME, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1E1E1E',
      },
    })
    monaco.editor.setTheme(EDITOR_THEME)
  }

  const setTypescriptCompilerOptions = (monaco: any) => {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(typescriptCompilerOptions)
  }

  const addResizeListener = () => {
    const resizeEditor = () => editorInstanceRef.current?.layout()
    window.addEventListener('resize', resizeEditor)
  }

  return (
    <div className="h-full w-full relative rounded-lg overflow-hidden">
      <div ref={editorRef} className="absolute inset-0" />
    </div>
  )
}
