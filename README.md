**Hot Snippet** is a Visual Studio Code extension that helps inserting user-defined snippets in a blazing fast way.

The problem with Visual Studio Code built-in snippets via IntelliSense menu is **too slow to show up**. Users who are typically type quickly will get annoyed by the slowness of IntelliSense menu, especially in a big repository.

## Basic usage

As soon as the extension is activated, it automatically sets `editor.snippetSuggestions` to `"off"`. Your key strokes are being monitored; whenever the key sequence matches the `prefix` defined in the user snippets (_File > Preferences > User Snippets_) and followed by Space (or Enter key, if `editor.acceptSuggestionOnEnter` is set to `"on"` or `"smart"`), it quickly inserts the matching snippet without waiting for IntelliSense menu.

Note that if the delay between each of your key sequence is longer than `editor.quickSuggestionsDelay`, the snippet will not be triggered.
