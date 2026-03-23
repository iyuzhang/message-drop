# LAN Message Drop - FINAL Execution Spec (Enhanced)

## 1. Product Definition

A LAN-based lightweight message drop system: - No accounts - No device
relationships - Instant usage - Text-first, file-supported - Shared
inbox model (NOT chat)

## 2. Core Model

Single Message Pool: - All devices can send/receive - No users,
sessions, contacts

## 3. Key Architecture

### PC (Dual Role)

Acts as BOTH: 1. Server: - HTTP + WebSocket server - Message Store
(authoritative) - File storage 2. Client: - Same UI as mobile - Uses
same APIs - Connect via localhost

### Mobile (Android)

-   Client only
-   Auto-connect to PC
-   Displays message pool

## 4. Functional Requirements

### Core

-   Send text messages
-   Receive message list
-   Cache ≥100 messages
-   File upload/download
-   Optional PIN per message

### PC Client

-   Must have UI
-   Can send/receive messages like mobile

### Testing Mode (Local Testing)

System must support: - Running 2+ clients on PC (different ports or
containers) - Clients must communicate via server - Used for validation
without mobile

## 5. Non-Goals

-   No login/account
-   No device binding
-   No chat sessions
-   No cloud dependency
-   No heavy frontend frameworks
-   No complex DB (SQLite optional)

## 6. Tech Stack (MANDATORY)

### Backend

-   Node.js
-   Hono
-   WebSocket (ws)

### Frontend

-   React

### Mobile

-   Android (Kotlin)
-   Minimal UI
-   WebView allowed if simpler

## 7. Networking

Must implement:

1.  mDNS discovery
2.  UDP broadcast fallback
3.  WebSocket communication
4.  Auto-reconnect

## 8. Message Format

{ "id": "uuid", "type": "text \| file", "content": "...", "file_url":
"...", "timestamp": 1234567890, "has_pin": true, "pin_hash": "..." }

## 9. File Handling

-   Files stored on PC disk
-   Persistent across restart
-   HTTP download endpoint required

## 10. UX Requirements

-   Open → see messages
-   Input auto-focus
-   Enter to send
-   Single page UI
-   No navigation

## 11. Platform Constraints

-   Android only (mobile)
-   No iOS support required
-   PC always-on

## 12. Acceptance Criteria

1.  Two PC clients can communicate
2.  Mobile connects within 2s
3.  Offline messages available
4.  PIN-protected messages require unlock
5.  Network switch recovery ≤3s

## 13. Development Phases

Phase 1: Message store (Node) Phase 2: WebSocket messaging Phase 3:
Multi-client (PC testing) Phase 4: File support Phase 5: Service
discovery Phase 6: Android client

Each phase MUST be runnable.

## 14. Logging

-   Discovery logs
-   Connection logs
-   Message logs

## 15. Debug Tools

-   Web debug page
-   Show connections
-   Show message pool

## 16. Fallback

-   mDNS → UDP
-   UDP → manual IP (hidden)

## 17. Execution Rules (CRITICAL)

-   DO NOT add extra features
-   DO NOT introduce accounts
-   DO NOT use heavy frameworks
-   MUST validate each phase before next

## 18. Local Development Environment

-   **Available:** Java 21, uv, pnpm, podman...
-   **Missing:** Mobile (Android) development environment
-   Agent may attempt to install mobile tooling; if blocked by environment
    issues (network, permissions, etc.), stop and let the user intervene.