import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import jdk.jshell.JShell;
import jdk.jshell.Snippet;
import jdk.jshell.SnippetEvent;
import jdk.jshell.SourceCodeAnalysis;

public class JShellServer {

    private static final int JSHELL_POOL_SIZE = 10;
    private static final int THREAD_POOL_SIZE = 20;

    private static final BlockingQueue<JShellWrapper> jshellPool = new LinkedBlockingQueue<>();

    private static void setupAutomaticImports(JShell jshell) {
        String[] autoImports = {
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
        };

        for (String importStatement : autoImports) {
            jshell.eval(importStatement);
        }
    }

    public static void main(String[] args) {
        int port = 9090;
        System.out.println("Attempting to start JShellServer on port " + port);
        ServerSocket serverSocket = null;

        ExecutorService threadPool = Executors.newFixedThreadPool(THREAD_POOL_SIZE);

        for (int i = 0; i < JSHELL_POOL_SIZE; i++) {
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            PrintStream printStream = new PrintStream(outputStream, true, StandardCharsets.UTF_8);
            JShell jshellInstance = JShell.builder()
                    .out(printStream)
                    .err(printStream)
                    .build();
            setupAutomaticImports(jshellInstance); // Add this line to set up automatic imports
            jshellPool.offer(new JShellWrapper(jshellInstance, outputStream));
        }

        try {
            serverSocket = new ServerSocket(port);
            System.out.println("JShellServer is running on port " + port);
            while (true) {
                Socket clientSocket = serverSocket.accept();
                JShellWrapper jshellWrapper = jshellPool.take();
                threadPool.execute(() -> handleClient(clientSocket, jshellWrapper));
            }
        } catch (IOException | InterruptedException e) {
            System.err.println("Server error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            closeServerSocket(serverSocket);
            threadPool.shutdown();
        }
    }

    private static void handleClient(Socket clientSocket, JShellWrapper jshellWrapper) {
        JShell jshell = jshellWrapper.getJshell();
        ByteArrayOutputStream jshellOutputStream = jshellWrapper.getOutputStream();

        try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(clientSocket.getOutputStream()))) {

            String code = readCodeFromClient(in);
            jshellOutputStream.reset();

            jshell.eval("/reset");

            List<String> snippets = parseCodeIntoSnippets(jshell, code);

            if (!evaluateSnippets(jshell, snippets, new PrintStream(jshellOutputStream))) {
                sendOutputToClient(out, jshellOutputStream);
                return;
            }

            sendOutputToClient(out, jshellOutputStream);

        } catch (IOException e) {
            System.err.println("Error handling client: " + e.getMessage());
            e.printStackTrace();
        } finally {
            jshellPool.offer(jshellWrapper);
            closeClientSocket(clientSocket);
        }
    }

    private static String readCodeFromClient(BufferedReader in) throws IOException {
        System.out.println("Reading code from client...");
        StringBuilder codeBuilder = new StringBuilder();
        String line;
        while ((line = in.readLine()) != null) {
            if (line.equals("END_OF_CODE")) {
                break;
            }
            codeBuilder.append(line).append("\n");
        }
        String code = codeBuilder.toString();
        System.out.println("Received code:\n" + code);
        return code;
    }

    private static List<String> parseCodeIntoSnippets(JShell jshell, String code) {
        List<String> snippets = new ArrayList<>();
        String remaining = code;
        SourceCodeAnalysis sourceCodeAnalysis = jshell.sourceCodeAnalysis();

        while (!remaining.isEmpty()) {
            SourceCodeAnalysis.CompletionInfo info = sourceCodeAnalysis.analyzeCompletion(remaining);
            snippets.add(info.source());
            remaining = info.remaining();
        }
        return snippets;
    }

    private static boolean evaluateSnippets(JShell jshell, List<String> snippets, PrintStream jshellPrintStream) {
        for (String snippet : snippets) {
            List<SnippetEvent> events = jshell.eval(snippet);
            for (SnippetEvent event : events) {
                if (event.status() == Snippet.Status.VALID) {
                    System.out.println("Evaluated: " + event.snippet().source());
                } else {
                    System.out.println("Error evaluating snippet: " + event.snippet().source());

                    jshell.diagnostics(event.snippet()).forEach(diag -> {
                        String errorMessage = diag.getMessage(null);
                        long startPos = diag.getStartPosition();
                        String snippetSource = event.snippet().source();

                        int lineNumber = 1;
                        int column = 1;
                        for (int i = 0; i < startPos && i < snippetSource.length(); i++) {
                            if (snippetSource.charAt(i) == '\n') {
                                lineNumber++;
                                column = 1;
                            } else {
                                column++;
                            }
                        }

                        System.out.println("Error at line " + lineNumber + ", column " + column + ": " + errorMessage);
                        jshellPrintStream
                                .println("Error at line " + lineNumber + ", column " + column + ": " + errorMessage);
                    });

                    return false;
                }
            }
        }
        return true;
    }

    private static void sendOutputToClient(BufferedWriter out, ByteArrayOutputStream jshellOutputStream)
            throws IOException {
        String jshellOutput = jshellOutputStream.toString(StandardCharsets.UTF_8.name());
        System.out.println("Sending output to client...");
        out.write(jshellOutput);
        out.write("END_OF_OUTPUT\n");
        out.flush();
        System.out.println("Output sent to client.");
    }

    private static void closeClientSocket(Socket clientSocket) {
        try {
            clientSocket.close();
            System.out.println("Client connection closed.");
        } catch (IOException e) {
            System.err.println("Error closing client connection: " + e.getMessage());
        }
    }

    private static void closeServerSocket(ServerSocket serverSocket) {
        try {
            if (serverSocket != null) {
                serverSocket.close();
                System.out.println("Server socket closed.");
            }
        } catch (IOException e) {
            System.err.println("Error closing server socket: " + e.getMessage());
        }
    }

    private static class JShellWrapper {
        private final JShell jshell;
        private final ByteArrayOutputStream outputStream;

        public JShellWrapper(JShell jshell, ByteArrayOutputStream outputStream) {
            this.jshell = jshell;
            this.outputStream = outputStream;
        }

        public JShell getJshell() {
            return jshell;
        }

        public ByteArrayOutputStream getOutputStream() {
            return outputStream;
        }
    }
}
