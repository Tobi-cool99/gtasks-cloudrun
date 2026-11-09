import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tasks_v1 } from "googleapis";
import { TaskActions, TaskResources } from "./Tasks.js";

const TOOLS = [
  {
    name: "search",
    description: "Search for a task in Google Tasks",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "list",
    description: "List all tasks in Google Tasks",
    inputSchema: {
      type: "object",
      properties: { cursor: { type: "string", description: "Cursor for pagination" } },
    },
  },
  {
    name: "create",
    description: "Create a new task in Google Tasks",
    inputSchema: {
      type: "object",
      properties: {
        taskListId: { type: "string", description: "Task list ID" },
        title: { type: "string", description: "Task title" },
        notes: { type: "string", description: "Task notes" },
        due: {
          type: "string",
          description: "Due date (YYYY-MM-DD or ISO 8601 format, e.g. 2025-03-19)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "clear",
    description: "Clear completed tasks from a Google Tasks task list",
    inputSchema: {
      type: "object",
      properties: { taskListId: { type: "string", description: "Task list ID" } },
      required: ["taskListId"],
    },
  },
  {
    name: "delete",
    description: "Delete a task in Google Tasks",
    inputSchema: {
      type: "object",
      properties: {
        taskListId: { type: "string", description: "Task list ID" },
        id: { type: "string", description: "Task id" },
      },
      required: ["id", "taskListId"],
    },
  },
  {
    name: "list-tasklists",
    description: "List all task lists in Google Tasks",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update",
    description: "Update a task in Google Tasks",
    inputSchema: {
      type: "object",
      properties: {
        taskListId: { type: "string", description: "Task list ID" },
        id: { type: "string", description: "Task ID" },
        uri: { type: "string", description: "Task URI" },
        title: { type: "string", description: "Task title" },
        notes: { type: "string", description: "Task notes" },
        status: {
          type: "string",
          enum: ["needsAction", "completed"],
          description: "Task status (needsAction or completed)",
        },
        due: {
          type: "string",
          description: "Due date (YYYY-MM-DD or ISO 8601 format, e.g. 2025-03-19)",
        },
      },
      required: ["id", "uri"],
    },
  },
];

/**
 * Baut einen MCP-Server, der die übergebene Google-Tasks-Client-Instanz nutzt.
 * Wird pro Anfrage erzeugt, damit jede Anfrage mit den Zugangsdaten des
 * angemeldeten Nutzers läuft.
 */
export function buildServer(tasks: tasks_v1.Tasks): Server {
  const server = new Server(
    { name: "gtasks-cloudrun", version: "0.2.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const [allTasks, nextPageToken] = await TaskResources.list(request, tasks);
    return {
      resources: allTasks.map((task) => ({
        uri: `gtasks:///${task.id}`,
        mimeType: "text/plain",
        name: task.title,
      })),
      nextCursor: nextPageToken,
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const task = await TaskResources.read(request, tasks);
    const taskDetails = [
      `Title: ${task.title || "No title"}`,
      `Status: ${task.status || "Unknown"}`,
      `Due: ${task.due || "Not set"}`,
      `Notes: ${task.notes || "No notes"}`,
      `Completed Date: ${task.completed || "Unknown"}`,
      `Updated: ${task.updated || "Unknown"}`,
    ].join("\n");
    return {
      contents: [{ uri: request.params.uri, mimeType: "text/plain", text: taskDetails }],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "search":
        return TaskActions.search(request, tasks);
      case "list":
        return TaskActions.list(request, tasks);
      case "create":
        return TaskActions.create(request, tasks);
      case "update":
        return TaskActions.update(request, tasks);
      case "delete":
        return TaskActions.delete(request, tasks);
      case "clear":
        return TaskActions.clear(request, tasks);
      case "list-tasklists": {
        const response = await tasks.tasklists.list();
        const taskLists = response.data.items || [];
        const formatted = taskLists
          .map((list) => `${list.title} (ID: ${list.id})`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                taskLists.length > 0
                  ? `Found ${taskLists.length} task lists:\n${formatted}`
                  : "No task lists found",
            },
          ],
        };
      }
      default:
        throw new Error("Tool not found");
    }
  });

  return server;
}
