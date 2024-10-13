package ai.proompteng.juge

import kotlinx.coroutines.*

class App

fun main() {
    runBlocking {
        val supervisorJob = SupervisorJob()
        val scope = CoroutineScope(Dispatchers.Default + supervisorJob)

        while (true) {
            val server = TcpServer(9090)
            val serverJob = scope.launch { server.start() }

            try {
                serverJob.join()
            } catch (e: CancellationException) {
                println("Server job was cancelled: ${e.message}")
            } catch (e: Exception) {
                println("Server encountered an error: ${e.message}")
            } finally {
                supervisorJob.cancelChildren()
                println("Server stopped")
            }

            delay(500)
        }
    }
}
