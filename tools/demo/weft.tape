# VHS tape → a real terminal GIF of an MCP session against the live Weft core.
# Render:
#   1. build + start the seeded core:   (cd crates/weft-core && cargo run --bin weft-demo-core)
#   2. in another shell:                vhs tools/demo/weft.tape
# Output: docs/media/weft-mcp-demo.gif
#
# Requires https://github.com/charmbracelet/vhs  (brew install vhs)

Output docs/media/weft-mcp-demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

Sleep 500ms
Type "# Weft: a website you're logged into, as an MCP server your AI can call"
Enter
Sleep 1.2s
Type "node tools/demo/mcp-demo.mjs"
Enter
Sleep 16s
