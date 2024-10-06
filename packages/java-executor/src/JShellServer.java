import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import jdk.jshell.JShell;
import jdk.jshell.Snippet;
import jdk.jshell.SnippetEvent;
import jdk.jshell.SourceCodeAnalysis;

public class JShellServer {

    public static void main(String[] args) {
        int port = 9090;
        System.out.println("Attempting to start JShellServer on port " + port);
        ServerSocket serverSocket = null;
        try {
            serverSocket = new ServerSocket(port);
            System.out.println("JShellServer is running on port " + port);
            while (true) {
                acceptClientConnection(serverSocket);
            }
        } catch (IOException e) {
            System.err.println("Failed to start server on port " + port + ": " + e.getMessage());
            e.printStackTrace();
        } finally {
            closeServerSocket(serverSocket);
        }
    }

    private static void acceptClientConnection(ServerSocket serverSocket) {
        try {
            System.out.println("Waiting for client connection...");
            Socket clientSocket = serverSocket.accept();
            System.out.println("New client connected: " + clientSocket.getInetAddress());
            new Thread(() -> handleClient(clientSocket)).start();
        } catch (IOException e) {
            System.err.println("Error accepting client connection: " + e.getMessage());
            e.printStackTrace();
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

    private static void handleClient(Socket clientSocket) {
        ByteArrayOutputStream jshellOutputStream = new ByteArrayOutputStream();
        PrintStream jshellPrintStream = new PrintStream(jshellOutputStream, true, StandardCharsets.UTF_8);
        JShell jshell = JShell.builder()
                .out(jshellPrintStream)
                .err(jshellPrintStream)
                .build();

        try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(clientSocket.getOutputStream()))) {

            String code = readCodeFromClient(in);
            List<String> snippets = parseCodeIntoSnippets(jshell, code);
            jshellOutputStream.reset();

            if (!evaluateSnippets(jshell, snippets, jshellPrintStream)) {
                sendOutputToClient(out, jshellOutputStream);
                return;
            }

            sendOutputToClient(out, jshellOutputStream);

        } catch (IOException e) {
            System.err.println("Error handling client: " + e.getMessage());
            e.printStackTrace();
        } finally {
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
                        for (int i = 0; i < startPos; i++) {
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
}
