# Preserve source text in the library

The library owns source preservation so each consumer does not need to reconstruct formatting or implement its own parser. A no-edit save returns exactly the supplied source text. Value edits preserve text outside necessary edit locations, and structural edits preserve unaffected text while applying a defined formatting policy to new text.

Consumers express whether an edit targets a shared definition or an individual instance. The library identifies the effects of supported edits. A mathematically smallest diff is not a requirement, since the smallest textual change can affect more instances than intended. Regenerating entire files from semantic results would discard source details that consumers need to preserve.
