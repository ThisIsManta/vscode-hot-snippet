**Hot Snippet** is a Visual Studio Code extension that helps quickly insert user-defined snippets.

## Quick start

1. Define your snippet normally according to https://code.visualstudio.com/docs/editor/userdefinedsnippets
```jsonc
{
  "function": {
    "prefix": "fx",
    "body": [
      "function($1) {",
      "\t$0",
      "}"
    ]
  }
}
```
2. Type the prefix, such as `fx` and immediately follow by a **SPACE** on your keyboard.
3. Expect the prefix to be replaced with the matching snippet.
![How to insert snippets](docs/add-snippet.gif)


## Advanced usage

This extension aims to solve the problem that adding a snippet from [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense) menu is _too slow to show up_. Developers who have fast-typing pace might get annoyed by the slowness of IntelliSense menu, especially in a big repository.

As soon as the extension is activated, it automatically sets `editor.snippetSuggestions` to `"off"` at user-level settings. This is to avoid redundant snippet suggestions offered by IntelliSense menu.

The extension reads your [global-scoped](https://code.visualstudio.com/docs/editor/userdefinedsnippets) and [project-scoped snippets](https://code.visualstudio.com/docs/editor/userdefinedsnippets#_project-snippet-scope) and monitors your keystrokes; whenever the key sequence matches the `prefix` defined in the user snippets (_File > Preferences > User Snippets_) followed by a **SPACE** key, it replaces the prefix with the matching snippet.

The [TextMate snippet syntax](https://code.visualstudio.com/docs/editor/userdefinedsnippets#_variables) `$TM_SELECTED_TEXT` will not work with this extension because you cannot have text selections while typing a prefix at the same time. Therefore, `$HS_SELECTED_TEXT` variable is introduced instead.

Below is an example of how to create a snippet for JavaScript.

```jsonc
{
  "const": {
    "prefix": "cs",
    "body": "const "
  },
  "log": {
    "prefix": "lg",
    "body": "console.log($HS_SELECTED_TEXT)"
  }
}
```
