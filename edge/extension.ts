import * as fs from 'fs/promises'
import * as JSON5 from 'json5'
import * as fp from 'path'
import compact from 'lodash/compact'
import groupBy from 'lodash/groupBy'
import sortBy from 'lodash/sortBy'
import escapeRegExp from 'lodash/escapeRegExp'
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

const SPACE = ' '

export async function activate(context: vscode.ExtensionContext) {
	// Disable built-in snippet feature completely
	const userConfig = vscode.workspace.getConfiguration('editor')
	if (userConfig.get<string>('snippetSuggestions') !== 'none') {
		userConfig.update('snippetSuggestions', 'none', vscode.ConfigurationTarget.Global)
	}

	const languages = new Map<Snippet['language'], Array<Snippet>>()

	const knownLanguages = new Set(await vscode.languages.getLanguages())

	async function updateSnippets(filePath: string) {
		removeSnippets(filePath)

		const keyedSnippets = groupBy(await createSnippets(filePath, knownLanguages), snippet => snippet.language)
		for (const language in keyedSnippets) {
			const sortedSnippets = sortBy(
				[...(languages.get(language) || []), ...keyedSnippets[language]],
				snippet => snippet.workspace ? 0 : 1, // Put project-scoped snippets first
			)
			languages.set(language, sortedSnippets)
		}
	}

	function removeSnippets(filePathOrWorkspace: string | vscode.WorkspaceFolder) {
		for (const [language, snippets] of languages) {
			languages.set(language, snippets.filter(snippet =>
				typeof filePathOrWorkspace === 'string'
					? snippet.filePath !== filePathOrWorkspace
					: snippet.workspace !== filePathOrWorkspace
			))
		}
	}

	// #region Global-scoped snippets
	const globalSnippetDirectoryPath = fp.resolve(context.globalStorageUri.fsPath, '..', '..', 'snippets')
	const globalSnippetFileNameList = await fs.readdir(globalSnippetDirectoryPath)
	for (const fileName of globalSnippetFileNameList) {
		await updateSnippets(fp.join(globalSnippetDirectoryPath, fileName))
	}

	const globalSnippetWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(globalSnippetDirectoryPath, '*'))
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

	async function updateWorkspaces({ added = [], removed = [] }: { added?: ReadonlyArray<vscode.WorkspaceFolder>, removed?: ReadonlyArray<vscode.WorkspaceFolder> }) {
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

	const state: {
		editing: boolean,
	} = {
		editing: false,
	}

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async e => {
		// Prevent the unwanted side effects from `editor.edit()` and `editor.insertSnippet()`
		if (state.editing) {
			return
		}

		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		const availableSnippets = [
			...(languages.get(e.document.languageId) || []),
			...(languages.get('*') || []),
		]
		if (availableSnippets.length === 0) {
			return
		}

		const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)
		const findSnippet = (word: string) => availableSnippets.find(snippet =>
			snippet.trigger.test(word) &&
			(snippet.workspace === undefined || snippet.workspace === workspace)
		)

		for (const change of e.contentChanges) {
			// Trigger snippet insertion when typing SPACE
			if (change.rangeLength > 0 || change.text !== SPACE) {
				continue
			}

			// Find one or more places to insert snippets
			const matches = compact(editor.selections.map(selection => {
				const range = editor.document.getWordRangeAtPosition(selection.active)
				if (!range) {
					return null
				}

				const word = editor.document.getText(range)
				if (!word) {
					return null
				}

				return { word, range: range.with(undefined, range.end.translate(undefined, SPACE.length)) }
			}))

			if (matches.length === 0) {
				return
			}

			if (matches.every(match => match.word === matches[0].word)) {
				const snippet = findSnippet(matches[0].word)
				if (!snippet) {
					return
				}

				const ranges = matches.map(({ range }) => range)

				// Insert snippets while preserving multi-cursors only if all prefixes are identical
				state.editing = true
				await editor.insertSnippet(snippet.replacement, ranges, { undoStopBefore: true, undoStopAfter: false })
				state.editing = false

			} else {
				// Prevent interlaced insertion by working from the bottommost first
				const reversedMatches = sortBy(matches, match => -match.range.start.line, match => -match.range.start.character)

				state.editing = true
				await Promise.all(reversedMatches.map(async match => {
					const snippet = findSnippet(match.word)
					if (!snippet) {
						return
					}

					// Insert snippets one-by-one
					await editor.insertSnippet(snippet.replacement, match.range, { undoStopBefore: true, undoStopAfter: false })
				}))
				state.editing = false
			}
		}
	}))
}

async function createSnippets(filePath: string, knownLanguages: Set<Snippet['language']>): Promise<Array<Snippet>> {
	const fileExtension = fp.extname(filePath).replace(/^\./, '')
	const fileName = fp.basename(filePath).replace(new RegExp(escapeRegExp('.' + fileExtension) + '$', 'i'), '').toLowerCase()

	if (fileExtension !== 'json' && fileExtension !== 'code-snippets') {
		return []
	}

	if (fileExtension === 'json' && knownLanguages.has(fileName) === false) {
		return []
	}

	const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))

	try {
		const text = await fs.readFile(filePath, 'utf-8')
		const json = JSON5.parse(text) as { [name: string]: { scope?: string, prefix: string | Array<string>, body: string | Array<string> } }

		return Object.values(json)
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
				trigger: new RegExp('(^|\\W)' + escapeRegExp(item.prefix) + '$'),
				replacement: item.body,
				filePath,
				workspace,
			}))
			.flatMap(({ language, ...rest }) =>
				(language || '*')
					.split(',')
					.map(language => language.trim())
					.filter(language => !!language)
					.map(language => ({ ...rest, language }))
			)
			.filter(({ language }) => language === '*' || knownLanguages.has(language))

	} catch (ex) {
		console.error(`Error parsing file ${filePath}:\n`, ex)
		return []
	}
}
