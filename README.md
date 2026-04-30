# Happy List

Offline-first household shopping list PWA. Installable on Android Chrome. Syncs across devices via a private GitHub repo.

---

## Hosting on GitHub Pages

1. Push this project to the `main` branch and enable GitHub Pages in the repo settings (Source: GitHub Actions)
2. The workflow at `.github/workflows/deploy.yml` auto-deploys on every push to `main`

---

## Setting up sync (one-time per device)

### Step 1 — Create a Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Set **Repository access** to "Only select repositories" → select your private data repo
4. Under **Repository permissions**, set **Contents** to **Read and Write**
5. Click **Generate token** and copy it immediately (you won't see it again)

### Step 2 — Configure the app

1. Open the app → tap **Settings** (⚙)
2. Enter your private data repo and paste your PAT
3. Tap **Save** then **Test connection** — you should see "Connection successful!"
4. The app will now sync automatically whenever you have an internet connection

### Step 3 — Install the app

On Android Chrome, tap the browser menu (⋮) → **Add to Home screen**. The app opens full-screen like a native app.

### Adding more devices

Repeat Steps 1–2 on each device using the same PAT (or generate a new one for the same repo).

---

## Features

- **Shopping List** — add items with name, quantity, unit, category, and one or more stores
- **Store Manager** — manage your stores with colour coding and ordering
- **Shop Mode** — select a store to get a category-grouped checklist; check items off as you shop; "Finish Trip" resets for next time while keeping history
- **Sync** — changes sync to your private GitHub data repo; works offline, syncs automatically on reconnect
- **Categories** — organise items into aisles (managed in Settings)
- **Export** — download a full JSON backup from Settings

---

## How sync works

All data is stored locally in your browser's IndexedDB (via [Dexie.js](https://dexie.org)). Every change is instant and works offline. When you go online, the app reads the current state from your private data repo, merges it with local data (last-write-wins by timestamp), and writes the result back. This keeps all your devices in sync without any backend server.
