#!/bin/bash
# Fix badge.html - text overflow when font size is increased
# Backup first
cp public/badge.html public/badge.html.bak

# Fix 1: visitor-name - add nowrap + ellipsis
python3 << 'PYEOF'
with open('public/badge.html', 'r') as f:
    content = f.read()

# Fix visitor-name: replace word-break with nowrap+ellipsis
content = content.replace(
    """.visitor-name {
      font-size: var(--font-size-name);
      font-weight: bold;
      margin-bottom: 2mm;
      line-height: 1.2;
      word-break: break-word;
    }""",
    """.visitor-name {
      font-size: var(--font-size-name);
      font-weight: bold;
      margin-bottom: 2mm;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }"""
)

# Fix visitor-company: replace word-break with nowrap+ellipsis
content = content.replace(
    """.visitor-company {
      font-size: var(--font-size-company);
      line-height: 1.2;
      word-break: break-word;
      margin-bottom: 1mm;
    }""",
    """.visitor-company {
      font-size: var(--font-size-company);
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      margin-bottom: 1mm;
    }"""
)

# Fix info-section: add max-height constraint
content = content.replace(
    """.info-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      overflow: hidden;
      min-width: 0;
    }""",
    """.info-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      overflow: hidden;
      min-width: 0;
      max-height: 100%;
    }"""
)

with open('public/badge.html', 'w') as f:
    f.write(content)

print('✅ badge.html text overflow fixed')
PYEOF
