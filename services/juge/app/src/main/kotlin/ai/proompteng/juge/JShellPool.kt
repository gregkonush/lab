package ai.proompteng.juge

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.atomicfu.atomic
import jdk.jshell.JShell
import java.io.ByteArrayOutputStream
import java.io.PrintStream

class JShellPool(private val poolSize: Int) {
    private val pool = Channel<Pair<JShell, ByteArrayOutputStream>>(Channel.UNLIMITED)
    private val inUseCount = atomic(0)

    init {
        repeat(poolSize) {
            val (jShell, outputStream) = createJShellInstance()
            pool.trySend(jShell to outputStream)
        }
    }

    private fun createJShellInstance(): Pair<JShell, ByteArrayOutputStream> {
        val outputStream = ByteArrayOutputStream()
        val printStream = PrintStream(outputStream)
        val jShell = JShell.builder().out(printStream).err(printStream).build()

        val imports = listOf(
            "import java.util.*;",
            "import java.lang.*;",
            "import java.io.*;",
            "import java.math.*;",
            "import java.text.*;",
            "import java.time.*;",
            "import java.util.concurrent.*;",
            "import java.util.function.*;",
            "import java.util.regex.*;",
            "import java.util.stream.*;"
        )

        jShell.eval(imports.joinToString("\n"))

        return jShell to outputStream
    }

    suspend fun <T> withJShell(block: suspend (JShell, ByteArrayOutputStream) -> T): T {
        val (jShell, outputStream) = acquireJShell()
        try {
            return block(jShell, outputStream)
        } finally {
            releaseJShell(jShell, outputStream)
        }
    }

    private suspend fun acquireJShell(): Pair<JShell, ByteArrayOutputStream> {
        while (true) {
            pool.tryReceive().getOrNull()?.let { return it }
            if (inUseCount.value < poolSize) {
                val (jShell, outputStream) = createJShellInstance()
                inUseCount.incrementAndGet()
                return jShell to outputStream
            }
            delay(10)
        }
    }

    private fun releaseJShell(jShell: JShell, outputStream: ByteArrayOutputStream) {
        jShell.snippets().forEach { jShell.drop(it) }
        outputStream.reset()
        pool.trySend(jShell to outputStream)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun close() {
        while (!pool.isEmpty) {
            pool.receive().first.close()
        }
    }
}
