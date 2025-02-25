import * as vscode from "vscode";
import { exec } from "child_process";
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
      if (editor.viewColumn === vscode.ViewColumn.One) {
        enableExecuteButton(false);
        const document = editor.document;
        const filePath = document.uri.fsPath;

        // 调用Java执行SPL
        executeSpl(filePath)
          .then((result) => {
            // 解析Java程序的输出为表格数据
            const tableData = parseJavaOutput(result);

            // 在右侧显示结果表格
            ResultTablePanel.createOrShow(
              context.extensionUri,
              tableData,
              context.subscriptions
            );
          })
          .catch((err) => {
            vscode.window.showErrorMessage(`${err.message}`);
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
        if (editors.length > 1) {
          // 没有打开编辑窗口也是1
          executeButton.show();
        } else {
          executeButton.hide();
        }
      }
    })
  );
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
      const javaPath = `${startHome}/common/jre/bin/java`;
      const mainClass = "com.scudata.ide.spl.VSCodeApi";
      const cmd = `"${javaPath}" -cp "${startHome}/esProc/lib/*;${startHome}/common/jdbc/*" -Dstart.home="${startHome}/${productName}" ${mainClass} -r "${filePath}"`;
      // console.log(cmd);
      // 调用 Java 程序
      const process = exec(cmd, (error, stdout, stderr) => {
        if (stderr) {
          console.error(stderr);
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

class ResultTablePanel {
  public static currentPanel: ResultTablePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableData: string[][],
    subscriptions: any
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // 设置 Webview 的 HTML 内容
    this.setHtml(tableData);

    // 监听 Webview 关闭事件
    this._panel.onDidDispose(() => this.dispose(), null, subscriptions);
  }

  public setHtml(tableData: string[][]) {
    this._panel.webview.html = this._getHtmlForWebview(
      this._panel.webview,
      tableData
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    tableData: string[][],
    subscriptions: any
  ) {
    if (ResultTablePanel.currentPanel) {
      ResultTablePanel.currentPanel.setHtml(tableData);
      ResultTablePanel.currentPanel._panel.reveal();
      return;
    }

    // 创建一个新的 Webview 面板
    const panel = vscode.window.createWebviewPanel(
      "resultTable", // 面板 ID
      "Result", // 面板标题
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
      subscriptions
    );
    return ResultTablePanel.currentPanel;
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    tableData: string[][]
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
                <h1>Result</h1>
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
