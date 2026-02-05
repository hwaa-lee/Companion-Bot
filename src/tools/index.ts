import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { MODELS, type ModelId } from "../ai/claude.js";
import { getCurrentChatId, setModel, getModel } from "../session/state.js";

const execAsync = promisify(exec);

// 허용된 디렉토리 (보안을 위해 제한)
const ALLOWED_PATHS = [
  "/Users/hwai/Documents",
  "/Users/hwai/projects",
];

function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return ALLOWED_PATHS.some((allowed) => resolved.startsWith(allowed));
}

// Tool 정의 (Claude API 형식)
export const tools = [
  {
    name: "read_file",
    description: "Read the contents of a file. Use this to view code, documents, or any text file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in a given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the directory to list",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command. Use with caution. Only for safe commands like git status, npm run, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to run",
        },
        cwd: {
          type: "string",
          description: "The working directory to run the command in (optional)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "change_model",
    description: `Change the AI model for this conversation. Use this when the user asks to switch models, or when you determine a different model would be better suited for the task.

Available models:
- "sonnet": Claude Sonnet 4 - Balanced performance and cost (default)
- "opus": Claude Opus 4 - Most capable, best for complex reasoning and coding
- "haiku": Claude Haiku 3.5 - Fastest and cheapest, good for simple tasks

Guidelines:
- Use opus for complex coding, architecture decisions, or deep analysis
- Use haiku for simple questions, quick lookups, or casual chat
- Use sonnet for general tasks (default)`,
    input_schema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          enum: ["sonnet", "opus", "haiku"],
          description: "The model to switch to",
        },
        reason: {
          type: "string",
          description: "Brief reason for the model change",
        },
      },
      required: ["model"],
    },
  },
];

// Tool 실행 함수
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const filePath = input.path as string;
        if (!isPathAllowed(filePath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        const content = await fs.readFile(filePath, "utf-8");
        return content;
      }

      case "write_file": {
        const filePath = input.path as string;
        const content = input.content as string;
        if (!isPathAllowed(filePath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return `File written successfully: ${filePath}`;
      }

      case "list_directory": {
        const dirPath = input.path as string;
        if (!isPathAllowed(dirPath)) {
          return `Error: Access denied. Path not in allowed directories.`;
        }
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const list = entries.map((e) =>
          `${e.isDirectory() ? "📁" : "📄"} ${e.name}`
        );
        return list.join("\n");
      }

      case "run_command": {
        const command = input.command as string;
        const cwd = (input.cwd as string) || "/Users/hwai/Documents";

        // 위험한 명령어 차단
        const dangerous = ["rm -rf", "sudo", "chmod", "chown", "> /dev", "mkfs"];
        if (dangerous.some((d) => command.includes(d))) {
          return `Error: Dangerous command blocked.`;
        }

        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: 30000,
        });
        return stdout || stderr || "Command executed (no output)";
      }

      case "change_model": {
        const modelId = input.model as ModelId;
        const reason = input.reason as string || "";
        const chatId = getCurrentChatId();

        if (!chatId) {
          return "Error: No active chat session";
        }

        if (!(modelId in MODELS)) {
          return `Error: Unknown model "${modelId}". Available: sonnet, opus, haiku`;
        }

        const oldModel = getModel(chatId);
        setModel(chatId, modelId);

        const newModel = MODELS[modelId];
        return `Model changed: ${MODELS[oldModel].name} → ${newModel.name}${reason ? ` (${reason})` : ""}. The change will take effect from the next message.`;
      }

      default:
        return `Error: Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
