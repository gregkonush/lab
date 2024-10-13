package ai.proompteng.juge

import kotlinx.coroutines.suspendCancellableCoroutine
import java.nio.ByteBuffer
import java.nio.channels.AsynchronousServerSocketChannel
import java.nio.channels.AsynchronousSocketChannel
import java.nio.channels.CompletionHandler
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

suspend fun AsynchronousServerSocketChannel.aAccept() = suspendCancellableCoroutine { cont ->
    accept(null, object : CompletionHandler<AsynchronousSocketChannel, Any?> {
        override fun completed(result: AsynchronousSocketChannel, attachment: Any?) {
            cont.resume(result)
        }

        override fun failed(exc: Throwable, attachment: Any?) {
            cont.resumeWithException(exc)
        }
    })
}

suspend fun AsynchronousSocketChannel.aRead(buffer: ByteBuffer) = suspendCancellableCoroutine { cont ->
    read(buffer, null, object : CompletionHandler<Int, Any?> {
        override fun completed(result: Int, attachment: Any?) {
            cont.resume(result)
        }

        override fun failed(exc: Throwable, attachment: Any?) {
            cont.resumeWithException(exc)
        }
    })
}

suspend fun AsynchronousSocketChannel.aWrite(buffer: ByteBuffer) = suspendCancellableCoroutine { cont ->
    write(buffer, null, object : CompletionHandler<Int, Any?> {
        override fun completed(result: Int, attachment: Any?) {
            cont.resume(result)
        }

        override fun failed(exc: Throwable, attachment: Any?) {
            cont.resumeWithException(exc)
        }
    })
}
