package ai.proompteng.juge

import kotlinx.coroutines.*
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.nio.channels.AsynchronousServerSocketChannel
import java.nio.channels.AsynchronousSocketChannel
import java.io.ByteArrayOutputStream
import jdk.jshell.JShell
import jdk.jshell.Snippet
import jdk.jshell.SnippetEvent
import java.util.Locale

class TcpServer(private val port: Int) {
    private val serverChannel = AsynchronousServerSocketChannel.open()
    private val jShellPool = JShellPool(Runtime.getRuntime().availableProcessors())

    suspend fun start() = coroutineScope {
        serverChannel.bind(InetSocketAddress(port))
        println("Server started on port $port")

        try {
            while (isActive) {
                val clientChannel = serverChannel.aAccept()
                launch { handleClient(clientChannel) }
            }
        } finally {
            serverChannel.close()
            jShellPool.close()
            println("Server stopped")
        }
    }

    private suspend fun handleClient(clientChannel: AsynchronousSocketChannel) {
        jShellPool.withJShell { jShell, outputStream ->
            clientChannel.use {
                val buffer = ByteBuffer.allocate(4096)
                val fullMessage = StringBuilder()

                while (true) {
                    val bytesRead = clientChannel.aRead(buffer)
                    if (bytesRead == -1) break

                    buffer.flip()
                    val message = String(buffer.array(), 0, bytesRead)
                    fullMessage.append(message)

                    if (fullMessage.endsWith("\n<<END_OF_CODE>>\n")) {
                        val code = fullMessage.removeSuffix("\n<<END_OF_CODE>>\n").toString()
                        println("Received full code block:\n$code")
                        jShell.eval("/reset")

                        val result = evaluateInJShell(jShell, outputStream, code)
                        val response = "$result\n<<END_OF_MESSAGE>>\n"
                        clientChannel.aWrite(ByteBuffer.wrap(response.toByteArray()))

                        fullMessage.clear()
                        clearJShell(jShell)
                    }

                    buffer.clear()
                }
            }
        }
    }

    private fun evaluateInJShell(jShell: JShell, outputStream: ByteArrayOutputStream, code: String): String {
        val output = StringBuilder()
        val snippets = parseCodeIntoSnippets(jShell, code)

        snippets.forEach { snippet ->
            jShell.eval(snippet).forEach { event ->
                when (event.status()) {
                    Snippet.Status.VALID -> {
                        event.value()?.takeIf { it != "null" }?.let { output.appendLine(it) }
                    }

                    Snippet.Status.REJECTED -> {
                        output.appendLine("Error: ${getDiagnostics(jShell, event)}")
                    }

                    else -> {}
                }
            }
        }

        outputStream.toString().trim().takeIf { it.isNotEmpty() }?.let {
            output.appendLine(it)
        }

        return output.toString().trim().ifEmpty { "Code executed successfully with no output." }
    }

    private fun parseCodeIntoSnippets(jShell: JShell, code: String): List<String> {
        val snippets = mutableListOf<String>()
        var remaining = code
        val sourceCodeAnalysis = jShell.sourceCodeAnalysis()

        while (remaining.isNotEmpty()) {
            val info = sourceCodeAnalysis.analyzeCompletion(remaining)
            snippets.add(info.source())
            remaining = info.remaining()
        }
        return snippets
    }

    private fun getDiagnostics(jShell: JShell, snippetEvent: SnippetEvent): String {
        return jShell.diagnostics(snippetEvent.snippet()).toList().joinToString("\n") { diag ->
            val errorMessage = diag.getMessage(Locale.getDefault())
            val startPos = diag.startPosition
            val snippetSource = snippetEvent.snippet().source()

            val (lineNumber, column) = snippetSource.take(startPos.toInt())
                .foldIndexed(1 to 1) { index, (line, col), char ->
                    if (char == '\n') (line + 1) to 1 else line to (col + 1)
                }

            "Error at line $lineNumber, column $column: $errorMessage"
        }
    }

    private fun clearJShell(jShell: JShell) {
        jShell.snippets().forEach { jShell.drop(it) }
    }
}
