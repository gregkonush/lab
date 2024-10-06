import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import jdk.jshell.JShell;

public class JShellServer {
    public static void main(String[] args) throws IOException {
        int port = 9090;
        System.out.println("Attempting to start JShellServer on port " + port);
        try {
            ServerSocket serverSocket = new ServerSocket(port);
            System.out.println("JShellServer is running on port " + port);

            // Redirect standard output
            ByteArrayOutputStream outputCapture = new ByteArrayOutputStream();
            PrintStream ps = new PrintStream(outputCapture, true, StandardCharsets.UTF_8.name());

            // Initialize JShell with the redirected output stream
            JShell jshell = JShell.builder()
                                  .out(ps)
                                  .build();

            while (true) {
                try {
                    System.out.println("Waiting for client connection...");
                    Socket clientSocket = serverSocket.accept();
                    System.out.println("New client connected: " + clientSocket.getInetAddress());
                    new Thread(() -> handleClient(clientSocket, jshell, outputCapture)).start();
                } catch (IOException e) {
                    System.err.println("Error accepting client connection: " + e.getMessage());
                    e.printStackTrace();
                }
            }
        } catch (IOException e) {
            System.err.println("Failed to start server on port " + port + ": " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void handleClient(Socket clientSocket, JShell jshell, ByteArrayOutputStream outputCapture) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(clientSocket.getOutputStream()))) {

            System.out.println("Reading code from client...");
            StringBuilder codeBuilder = new StringBuilder();
            String line;
            while ((line = in.readLine()) != null) {
                System.out.println("Received line: " + line);
                if (line.equals("END_OF_CODE")) {
                    break;
                }
                codeBuilder.append(line).append("\n");
            }
            String code = codeBuilder.toString();
            System.out.println("Received code:\n" + code);

            System.out.println("Evaluating code...");
            // Clear the captured output before evaluation
            outputCapture.reset();

            jshell.eval(code);

            // Get the captured output
            String output = outputCapture.toString(StandardCharsets.UTF_8.name());
            System.out.println("Evaluation result:\n" + output);

            System.out.println("Sending output to client...");
            out.write(output);
            out.write("END_OF_OUTPUT\n");
            out.flush();
            System.out.println("Output sent to client.");

        } catch (IOException e) {
            System.err.println("Error handling client: " + e.getMessage());
            e.printStackTrace();
        } finally {
            try {
                clientSocket.close();
                System.out.println("Client connection closed.");
            } catch (IOException e) {
                System.err.println("Error closing client connection: " + e.getMessage());
            }
        }
    }
}
