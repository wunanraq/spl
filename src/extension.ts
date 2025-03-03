import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";

let executeButton: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // 在状态栏添加执行按钮
  executeButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  executeButton.name = "exec button";
  executeButton.command = "extension.executeSpl";
  executeButton.text = "$(play) Execute SPL";
  executeButton.show();
  context.subscriptions.push(executeButton);

  vscode.commands.registerCommand("extension.executeSpl", () => {
    vscode.window.visibleTextEditors.forEach((editor) => {
      const document = editor.document;
      const filePath = document.uri.fsPath;
      if (filePath && filePath.toLowerCase().endsWith(".spl")) {
        enableExecuteButton(false);
        // 调用Java执行SPL
        executeSpl(filePath)
          .then(
            (result) => {
              // 解析Java程序的输出为表格数据
              const tableData = parseJavaOutput(result);

              // 在右侧显示结果表格
              ResultTablePanel.createOrShow(
                context.extensionUri,
                tableData,
                context.subscriptions,
                "Result"
              );
            },
            (errorMessage) => {
              const tableData = [[errorMessage]];
              // 在右侧显示结果表格
              ResultTablePanel.createOrShow(
                context.extensionUri,
                tableData,
                context.subscriptions,
                "Error"
              );
            }
          )
          .catch((err) => {
            const tableData = [[err.message]];
            // 在右侧显示结果表格
            ResultTablePanel.createOrShow(
              context.extensionUri,
              tableData,
              context.subscriptions,
              "Error"
            );
          })
          .finally(() => {
            enableExecuteButton(true);
          });
      }
    });
  });

  // 将事件监听器添加到扩展的订阅中
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (executeButton) {
        if (editors.length > 0) {
          executeButton.show();
        } else {
          executeButton.hide();
        }
      }
    })
  );
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const document = editor.document;
    const filePath = document.uri.fsPath;
    if (filePath && filePath.toLowerCase().endsWith(".spl")) {
      // 修改编辑器选项
      editor.options = {
        ...editor.options,
        insertSpaces: false, // 使用制表符
        tabSize: 4, // 设置制表符宽度
      };
    }
  }

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      const document = editor.document;
      const filePath = document.uri.fsPath;
      if (filePath && filePath.toLowerCase().endsWith(".spl")) {
        // 修改编辑器选项
        editor.options = {
          ...editor.options,
          insertSpaces: false, // 使用制表符
          tabSize: 4, // 设置制表符宽度
        };
      }
    }
  });
}

function enableExecuteButton(enabled: boolean) {
  if (executeButton) {
    if (enabled) {
      // 重新启用状态栏控件
      executeButton.command = "extension.executeSpl";
      executeButton.text = "$(play) Execute SPL";
      executeButton.tooltip = undefined;
    } else {
      // 禁用状态栏控件
      executeButton.command = undefined;
      executeButton.text = "$(sync~spin) Processing...";
      executeButton.tooltip = "Please wait...";
    }
  }
}

async function executeSpl(filePath: string): Promise<string> {
  // 执行前自动保存
  await vscode.commands.executeCommand("workbench.action.files.save");
  return new Promise((resolve, reject) => {
    const config = vscode.workspace.getConfiguration("SPL");
    const esProcHome = config.get<string>("Config");
    if (esProcHome) {
      const startHome = path.dirname(esProcHome);
      const productName = path.basename(esProcHome);
      var javaPath = "java";
      if (fs.existsSync(`${startHome}/common/jre/`)) {
        javaPath = `"${startHome}/common/jre/bin/java"`;
      }
      const mainClass = "com.scudata.ide.spl.VSCodeApi";
      var cmd;
      if (isWindows()) {
        cmd = `${javaPath} -cp "${startHome}/${productName}/lib/*;${startHome}/common/jdbc/*;${startHome}/${productName}/classes" -Dstart.home="${startHome}/${productName}" ${mainClass} -r "${filePath}"`;
      } else {
        cmd = `${javaPath} -cp "${startHome}/${productName}/lib/*:${startHome}/common/jdbc/*:${startHome}/${productName}/classes" -Dstart.home="${startHome}/${productName}" ${mainClass} -r "${filePath}"`;
      }
      // 调用 Java 程序
      const process = exec(cmd, (error, stdout, stderr) => {
        if (stderr) {
          console.log(stderr);
          // 按行分割文本
          const lines = stderr.split("\n");
          // 遍历每一行
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 检查是否包含 "Exception" 或 "Error" 或 "Throwable"
            if (
              line.includes("Exception") ||
              line.includes("Error") ||
              line.includes("Throwable")
            ) {
              // 找到目标行后，将文本从该行开始分割成两段
              const errText = lines.slice(i).join("\n"); // 取后半段
              reject(errText);
            }
          }
        }
        resolve(stdout);
      });
    } else {
      throw new Error("SPL Home needs to be set up.");
    }
  });
}

function parseJavaOutput(output: string): string[][] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
}

function isWindows(): boolean {
  const platform = process.platform.toLowerCase();
  console.log(platform);
  return platform.includes('win');
}

class ResultTablePanel {
  public static currentPanel: ResultTablePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableData: string[][],
    subscriptions: any,
    displayTitle: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // 设置 Webview 的 HTML 内容
    this.setHtml(tableData, displayTitle);

    // 监听 Webview 关闭事件
    this._panel.onDidDispose(() => this.dispose(), null, subscriptions);
  }

  public setHtml(tableData: string[][], displayTitle: string) {
    this._panel.webview.html = this._getHtmlForWebview(
      this._panel.webview,
      tableData,
      displayTitle
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    tableData: string[][],
    subscriptions: any,
    displayTitle: string
  ) {
    if (ResultTablePanel.currentPanel) {
      ResultTablePanel.currentPanel.setHtml(tableData, displayTitle);
      ResultTablePanel.currentPanel._panel.reveal();
      return;
    }

    // 创建一个新的 Webview 面板
    const panel = vscode.window.createWebviewPanel(
      "resultTable", // 面板 ID
      displayTitle, // 面板标题
      vscode.ViewColumn.Two, // 显示在第二列
      {
        enableScripts: true, // 启用 JavaScript
        retainContextWhenHidden: true, // 保持上下文
        localResourceRoots: [extensionUri], // 允许加载本地资源
      }
    );

    ResultTablePanel.currentPanel = new ResultTablePanel(
      panel,
      extensionUri,
      tableData,
      subscriptions,
      displayTitle
    );
    return ResultTablePanel.currentPanel;
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    tableData: string[][],
    displayTitle: string
  ): string {
    // 加载本地资源（如 CSS）
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "tableEditor.css")
    );
    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Result</title>
            </head>
            <body>
                <h1>${displayTitle}</h1>
                <div id="table-container">
                    <table id="result-table">
                        <tbody>
                            ${tableData
                              .map(
                                (row) => `
                                <tr>
                                    ${row
                                      .map((cell) => `<td>${cell}</td>`)
                                      .join("")}
                                </tr>
                            `
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `;
  }

  public dispose() {
    ResultTablePanel.currentPanel = undefined;
    this._panel.dispose();
  }
}

export function deactivate() {
  if (ResultTablePanel.currentPanel) {
    ResultTablePanel.currentPanel.dispose();
  }
  if (executeButton) {
    executeButton.dispose();
  }
}
