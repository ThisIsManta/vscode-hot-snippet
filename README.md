**Hot Snippet** is a Visual Studio Code extension that helps inserting user-defined snippets in a blazing fast way.

The problem with Visual Studio Code built-in snippets via IntelliSense menu is **too slow to show up**. Users who are typically type quickly will get annoyed by the slowness of IntelliSense menu, especially in a big repository.

## Basic usage

As soon as the extension is activated, it automatically sets `editor.snippetSuggestions` to `"off"`. Your key strokes are being monitored; whenever the key sequence matches the `prefix` defined in the user snippets (_File > Preferences > User Snippets_) and followed by Space (or Enter key, if `editor.acceptSuggestionOnEnter` is set to `"on"` or `"smart"`), it quickly inserts the matching snippet without waiting for IntelliSense menu.

For example, given the below JavaScript snippet template.

```json
{
  "const": {
    "prefix": "cs",
    "body": "const "
  },
  "function": {
	"prefix": "fx",
	"body": ["function($1) {", "\t$0", "}"]
  },
  "log": {
	"prefix": "lg",
	"body": "console.log($1)$0"
  }
}
```

You can quickly type `cs`, `fx`, and `lg` to generate `const`, `function`, and `console.log()` respectively.

![Add a snippet](docs/add-snippet.gif)

Note that if the delay between each of your key sequence is longer than `editor.quickSuggestionsDelay`, the snippet will not be triggered.
