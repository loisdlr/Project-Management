# DualFlow Trello-Style Project Manager

A simple two-user Kanban project management web app inspired by Trello.

## Main features
- Trello-style card board
- Four lists: To Do, In Progress, Review, Done
- Drag and drop cards between lists
- Two users / assignees
- Multiple projects
- Project filter
- Assignee filter
- Priority filter
- Card search
- Priority labels
- Due dates and overdue indicators
- Card descriptions
- Simple checklist support
- Project progress
- Create, edit and delete cards
- Create, edit and delete projects
- Browser localStorage persistence

## Checklist format
Inside a card, enter one checklist item per line.

You can also mark items completed using:

[x] Completed item
[ ] Incomplete item

## Run
Open `index.html` in your browser.

Or start a local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Important for two real users
This version saves data in the browser. It does not yet synchronize changes between two different computers.

For real-time shared use, the next step is to connect it to Firebase, Supabase, or Google Sheets + Apps Script and add user login/authentication.
