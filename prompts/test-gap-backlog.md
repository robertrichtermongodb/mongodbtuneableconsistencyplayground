# Test Gap Backlog

Prioritized list of untested or under-tested areas. Use this as a backlog for future iterations.

## Covered (iteration 28)

### ~~1. `checkPartitionHealed()` — app.js~~ → partially covered
Reconciliation logic tested via `healPartition()` in `test/app.test.js` partition reconciliation test.
Still needs: direct unit tests for cap behavior and no-op case.

### ~~2. Read-after-write consistency scenarios~~ → covered
`test/app.test.js` — rc:local returns stale v0 during write; rc:majority returns v1 after write.

### ~~3. Double election~~ → covered
`test/app.test.js` — two full election cycles with data survival; rolled-back data does not reappear.

### ~~5. Reconciliation after force election + partition heal~~ → covered
`test/app.test.js` — partition → force election → heal → all nodes consistent.

### Scenario integration tests → covered
`test/scenarios.test.js` — all 7 predefined scenarios (safe-write, partition-safe, snapshot-isolation, linearizable, w1-data-loss, dirty-read, fire-forget).

### ~~4. Client targeting + read operations~~ → covered (iteration 29)
`test/app.test.js` — manual target overrides readPreference, dead target errors, isolated secondary returns stale data, effectiveWriteTarget override.

### ~~7. `cycleClientTarget()` cycling~~ → covered (iteration 29)
`test/app.test.js` — write/read client cycle through null → primary → s1 → s2 → null; cycling works after election.

## High Priority

### 6. Write machine with client targeting mid-write
What happens if targetNode changes during an active write machine? (Edge case — probably fine since machine captures target at creation time)

### 8. Canvas interaction integration
These are harder to test (need DOM):
- Client drag + release without movement triggers target cycle
- Reset-UI button clears targeting
- Force election button visibility after various topology changes

## Low Priority

### 9. `syncButtons` edge cases
- Multiple simultaneous engines (should not happen, but guard against)
- Button positioning after canvas resize

### 10. Theme switching
- `applyTheme` sets all CSS custom properties
- Canvas redraws with correct colors after switch
