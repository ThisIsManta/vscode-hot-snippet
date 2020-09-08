import { promises as fs } from 'fs'
import * as JSON5 from 'json5'
import * as fp from 'path'
import * as _ from 'lodash'
import * as vscode from 'vscode'

type Snippet = {
    /**
     * Represent language ID.
     * This can be "*" where it represents all language.
     */
    language: vscode.TextDocument['languageId']

    /**
     * Represent the regular expression of the prefix field.
     */
    trigger: RegExp

    replacement: vscode.SnippetString

    /**
     * Represent the source file path of the current snippet.
     */
    filePath: string

    /**
     * Represent the source file path of the [project-scoped](https://code.visualstudio.com/docs/editor/userdefinedsnippets#_project-snippet-scope) snippet.
     * This will be `undefined` if and only if the current snippet is a global-scoped snippet.
     */
    workspace?: vscode.WorkspaceFolder
}

export async function activate(context: vscode.ExtensionContext) {
    // Disable built-in snippet feature completely
    const userConfig = vscode.workspace.getConfiguration('editor')
    if (userConfig.get<string>('snippetSuggestions') !== 'none') {
        userConfig.update('snippetSuggestions', 'none', vscode.ConfigurationTarget.Global)
    }

    const languages = new Map<vscode.TextDocument['languageId'], Array<Snippet>>()

    async function updateSnippets(filePath: string) {
        removeSnippets(filePath)

        const keyedSnippets = _.groupBy(await createSnippets(filePath), snippet => snippet.language)
        for (const language in keyedSnippets) {
            const sortedSnippets = _.sortBy(
                [...(languages.get(language) || []), ...keyedSnippets[language]],
                snippet => snippet.workspace ? 0 : 1, // Put project-scoped snippets first
            )
            languages.set(language, sortedSnippets)
        }
    }

    function removeSnippets(filePathOrWorkspace: string | vscode.WorkspaceFolder) {
        for (const [language, snippets] of languages) {
            languages.set(language, _.reject(snippets, snippet =>
                typeof filePathOrWorkspace === 'string'
                    ? snippet.filePath === filePathOrWorkspace
                    : snippet.workspace === filePathOrWorkspace
            ))
        }
    }

    // #region Global-scoped snippets
    const globalSnippetDirectoryPath = fp.resolve(context.globalStoragePath, '..', '..', 'snippets')
    const globalSnippetFileNameList = await fs.readdir(globalSnippetDirectoryPath)
    for (const fileName of globalSnippetFileNameList) {
        await updateSnippets(fp.join(globalSnippetDirectoryPath, fileName))
    }

    const globalSnippetWatcher = vscode.workspace.createFileSystemWatcher(fp.join(globalSnippetDirectoryPath, '*.{json,code-snippets}'))
    context.subscriptions.push(globalSnippetWatcher)
    context.subscriptions.push(globalSnippetWatcher.onDidCreate(e => {
        updateSnippets(e.fsPath)
    }))
    context.subscriptions.push(globalSnippetWatcher.onDidChange(e => {
        updateSnippets(e.fsPath)
    }))
    context.subscriptions.push(globalSnippetWatcher.onDidDelete(e => {
        removeSnippets(e.fsPath)
    }))
    // #endregion

    // #region Project-scoped snippets
    const localSnippetWatchers = new WeakMap<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()

    await updateWorkspaces({ added: vscode.workspace.workspaceFolders })

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        updateWorkspaces(e)
    }))

    async function updateWorkspaces({ added = [], removed = [] }: { added?: Array<vscode.WorkspaceFolder>, removed?: Array<vscode.WorkspaceFolder> }) {
        const localSnippetDirectoryName = fp.join('.vscode', '*.code-snippets')

        // Add project-scoped snippets; made possible by `findFiles` which returns all matching files in every opening workspace
        if (added.length > 0) {
            const fileList = await vscode.workspace.findFiles(localSnippetDirectoryName)
            for (const fileLink of fileList) {
                await updateSnippets(fileLink.fsPath)
            }
        }

        // Begin watching project-scoped snippets
        for (const workspace of added.filter(workspace => localSnippetWatchers.has(workspace) === false)) {
            const watcher = vscode.workspace.createFileSystemWatcher(fp.join(workspace.uri.fsPath, localSnippetDirectoryName))
            localSnippetWatchers.set(workspace, watcher)
            context.subscriptions.push(watcher)
            context.subscriptions.push(watcher.onDidCreate(async e => {
                await updateSnippets(e.fsPath)
            }))
            context.subscriptions.push(watcher.onDidChange(async e => {
                await updateSnippets(e.fsPath)
            }))
            context.subscriptions.push(watcher.onDidDelete(e => {
                removeSnippets(e.fsPath)
            }))
        }

        // Stop watching project-scoped snippets in removed workspaces
        for (const workspace of removed) {
            const watcher = localSnippetWatchers.get(workspace)
            if (watcher) {
                watcher.dispose()
                localSnippetWatchers.delete(workspace)
            }

            removeSnippets(workspace)
        }
    }
    // #endregion

    const editing = { state: false }

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async e => {
        // Prevent the unwanted side effects from `editor.edit()` and `editor.insertSnippet()`
        if (editing.state) {
            return
        }

        for (const change of e.contentChanges) {
            if (change.rangeLength > 0) {
                continue
            }

            if (change.text.startsWith(' ')) {
                const editor = vscode.window.activeTextEditor
                if (!editor) {
                    continue
                }

                const span = editor.document.getWordRangeAtPosition(editor.selection.active)
                if (!span) {
                    return
                }

                const word = editor.document.getText(span)
                if (!word) {
                    return
                }

                const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)
                const snippets = _.concat(languages.get(editor.document.languageId) || [], languages.get('*') || [])
                const snippet = snippets.find(snippet => snippet.trigger.test(word) && (snippet.workspace === undefined || snippet.workspace === workspace))
                if (!snippet) {
                    continue
                }

                const spanWithSpace = span.with(undefined, span.end.translate(undefined, 1))
                editing.state = true
                await editor.insertSnippet(snippet.replacement, spanWithSpace, { undoStopBefore: true, undoStopAfter: false })
                editing.state = false
            }
        }
    }))
}

async function createSnippets(filePath: string): Promise<Array<Snippet>> {
    const fileExtension = fp.extname(filePath).replace(/^\./, '')
    const fileName = fp.basename(filePath).replace(new RegExp(_.escapeRegExp(fileExtension) + '$', 'i'), '').toLowerCase()

    if (fileExtension !== 'json' && fileExtension !== 'code-snippets') {
        return []
    }

    const knownLanguages = await vscode.languages.getLanguages()

    if (fileExtension === 'json' && knownLanguages.includes(fileName) === false) {
        return []
    }

    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))

    try {
        const text = await fs.readFile(filePath, 'utf-8')
        const json = JSON5.parse(text) as { [name: string]: { scope?: string, prefix: string | Array<string>, body: string | Array<string> } }

        return _.chain(json)
            .toPairs()
            .map(([, item]) => item)
            .map(item => ({
                ...item,
                body: new vscode.SnippetString(
                    Array.isArray(item.body)
                        ? item.body.join('\n')
                        : item.body
                )
            }))
            .flatMap(({ prefix, ...rest }) =>
                Array.isArray(prefix)
                    ? prefix.map(prefix => ({ ...rest, prefix }))
                    : { ...rest, prefix }
            )
            .map(item => ({
                language: fileExtension === 'code-snippets' ? item.scope : fileName,
                trigger: new RegExp('(^|\\W)' + _.escapeRegExp(item.prefix) + '$'),
                replacement: item.body,
                filePath,
                workspace,
            }))
            .flatMap(({ language, ...rest }) =>
                _.chain(language || '*')
                    .split(',')
                    .map(language => language.trim())
                    .compact()
                    .map(language => ({ ...rest, language }))
                    .value()
            )
            .filter(({ language }) => language === '*' || knownLanguages.includes(language))
            .value()

    } catch (ex) {
        console.error(`Error parsing file ${filePath}:\n`, ex)
        return []
    }
}
