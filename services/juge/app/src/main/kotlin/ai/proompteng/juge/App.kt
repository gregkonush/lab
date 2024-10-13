package ai.proompteng.juge

import kotlinx.coroutines.*
import kotlinx.coroutines.selects.select
import kotlin.io.path.Path

class App

fun main() {
    runBlocking {
        while (true) {
            val server = TcpServer(9090)
            val serverJob = launch { server.start() }

            select {
                serverJob.onJoin { println("Server stopped") }
            }

            serverJob.join()
            delay(500)
        }
    }
}