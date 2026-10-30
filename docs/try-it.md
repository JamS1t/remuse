# Try Remuse on one of your own tasks

Thanks for trying this. It takes about 15 minutes. You'll teach Remuse one boring browser task you really do, by doing it once while you talk, and then watch it do the task for you.

## What you need

- A Windows PC with Google Chrome.
- [Node.js 24 or newer](https://nodejs.org).
- One task you do in the browser more than once a week. Good examples:
  - Answering the same kind of message (support emails, marketplace inquiries).
  - Copying numbers from one site into a spreadsheet (sales, views, stock).
  - Checking something and writing it down (order status, a price, a balance).
  - Posting the same thing in a few places.

Pick something where a mistake is cheap. Remuse stops and asks before it sends, pays or submits anything (unless you choose "Run without asking"), but start small anyway.

## What leaves your computer

- **Sent to Meta's AI models** (through the Remuse server, or directly if you set your own key): your voice while recording, screenshots, and the text of the pages it works on. It needs these to understand and check the task. Don't teach it on pages with information you can't share that way.
- **Stays on your PC:** your tasks, recordings and run history (in the `backend/data` folder), and the logins you share with **Use my login** (`backend/data/logins.json`). Google logins are never copied.

## Set it up (5 minutes)

1. Download this project: on GitHub, choose **Code → Download ZIP** and unzip it, or clone it.
2. Right-click `scripts\install-windows.ps1` and choose **Run with PowerShell**. It installs the Remuse Agent, makes it start with Windows, and opens `chrome://extensions`.
3. On that page, turn on **Developer mode**, click **Load unpacked**, and pick the `extension` folder.
4. Click the Remuse icon in Chrome's toolbar. The sidebar opens.

## Teach it (2 minutes)

1. Go to the site where your task starts. If it needs your login, press **Use my login** in the sidebar first.
2. Press **Watch me do a task** (the first time, allow the microphone).
3. Do the task once, normally, and **say why as you go**: "I open the oldest message… if they're asking about the price, I reply with the price list… if it's a complaint, I leave it for myself."
4. Press **Stop, I've shown you**.

Remuse then works out the steps and your rules, writes them as code, and practices once on your example. The sidebar shows what it understood. If something's off, just say it out loud ("no, only the ones from today"). It's listening.

## Let it work

Under **Do it again**, press **Again** on your task, then **Do it now**. If there are several items, it first shows you its plan ("5 replies · 2 left for you") and waits for **Go**. It asks before anything it would send.

## Tell us how it went

Please answer these in a [GitHub issue](https://github.com/JamS1t/remuse/issues/new?template=tried-remuse.md), or just message us. Describe your task in general words, and don't paste real customer names, emails or screenshots of private pages into the issue (it's public).

1. What task did you teach it?
2. How long does that task take you by hand, each time?
3. Did Remuse get it right? What did it get wrong or ask you about?
4. Would you use it for this task every week? Why or why not?
5. Anything that confused you?

Your words may be quoted (first name only, or anonymous if you prefer, so say which).

## Removing it

1. In `chrome://extensions`, remove **Remuse**.
2. Delete the **Remuse Agent** shortcut from your Startup folder (press Win+R, type `shell:startup`, Enter).
3. Stop the Agent (restart Windows, or end the `node.exe` running Remuse in Task Manager), then delete the project folder. That removes your tasks, recordings and shared logins with it.
