package ai.proompteng.juge

import kotlinx.coroutines.*
import java.nio.file.*

class FileWatcher(directory: Path) {
    private val watchService: WatchService = FileSystems.getDefault().newWatchService()

    init {
        directory.register(
            watchService,
            StandardWatchEventKinds.ENTRY_MODIFY,
            StandardWatchEventKinds.ENTRY_CREATE,
            StandardWatchEventKinds.ENTRY_DELETE
        )
    }

    suspend fun watchForChanges() = withContext(Dispatchers.IO) {
        while (true) {
            val key = watchService.take()
            val events = key.pollEvents()
            if (events.isNotEmpty()) {
                key.reset()
                return@withContext
            }
            if (!key.reset()) {
                break
            }
        }
    }
}
