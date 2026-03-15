3. Handling Complex Read Concerns Pragmatically
You asked how to handle rc:linearizable and rc:snapshot in an educational way that fits your current Step Engine without a full redo. Here is how you can visualize them using your existing architecture.

A. rc:linearizable (Preventing Stale Primary Reads)
The Concept: Linearizable reads ensure a client doesn't read stale data from a Primary that has been partitioned off from the network and doesn't yet realize it has been deposed.
The Pragmatic Implementation: You already noted that the Primary does a w:majority check. You can simulate this entirely within your buildReadSteps() using your existing particles and engine.js:

Step 1: Read client sends a particle to the Primary.

Step 2 (The Quorum Check): Before returning the data, the Primary sends special "ping" particles to S1 and S2 simultaneously.

Step 3: Wait for at least one Secondary to return an "ack" particle back to the Primary.

If the Primary is partitioned from the Secondaries (which the user can trigger via your fault injection): The read engine hangs here indefinitely (or times out), perfectly illustrating how linearizable protects against partitioned primaries.

Step 4: Primary returns the majorityCommitId version to the Read Client.

B. rc:snapshot (Sessions & Point-in-Time)
The Concept: Snapshot reads are tied to Causal Consistency and Multi-Document Transactions. They guarantee that all reads within a session view the data as it existed at a specific, invariant point in time, even if the background data continues to update.
The Pragmatic Implementation: Since you only have a single document ("doc #1"), building multi-document transactions is overkill. Instead, fake a "Session" to illustrate MVCC:

UI Addition: In the Read Config, if rc:snapshot is selected, change the "Query doc" button to a toggle: "Start Session & Read" -> "Read Again" -> "End Session".

State Logic: When the session starts, store the current state.doc.majorityCommitId in the readClient state as sessionSnapshotId.

The Engine: When the user clicks "Read Again", the target node evaluates the request. Even if the node's docVersionId is at v5, the node explicitly returns the sessionSnapshotId (e.g., v2).

The Visual: Show the Read Client fetching an older version while the latestId in the Ledger is visibly higher. This clearly demonstrates how snapshot isolates the reader from ongoing concurrent writes.