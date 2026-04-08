# Test Gap Backlog

Prioritized list of untested or under-tested areas. Use this as a backlog for future iterations.

## High Priority

### 1. `checkPartitionHealed()` — app.js (untested)
Currently only tested indirectly through integration. Needs unit tests:
- Caps memoryVersion/journalVersion of reconnected nodes to majorityCommitId
- Resets phases to idle
- No-op when no nodes were isolated

### 2. Read-after-write consistency scenarios
Write with w:majority, then read from a specific secondary with rc:local before replication completes.
- Should return stale data (v0) from the secondary
- Important for demonstrating the value of read concerns

### 3. Double election (elect, then kill new primary, elect again)
Verifies that state resets cleanly across multiple election cycles:
- Labels cycle correctly
- Rolled-back data doesn't reappear
- Client targeting resets

### 4. Client targeting + read operations
- Manual read target with rc:linearizable should still return data (even though linearizable normally forces primary)
- Manual read target to a dead node — how does it behave?
- Read from isolated node — served version should still work but may be stale

## Medium Priority

### 5. Reconciliation after force election + partition heal
Full flow: partition primary → force election → restore links → verify all nodes have consistent state

### 6. Write machine with client targeting mid-write
What happens if targetNode changes during an active write machine? (Edge case — probably fine since machine captures target at creation time)

### 7. `cycleClientTarget()` cycling
- Cycles through null → primary → s1 → s2 → null
- After election where primaryKey changed, cycling still works

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
