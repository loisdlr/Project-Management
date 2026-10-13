# DualFlow Shared Online — Setup Guide

This version is designed for **two real users on separate phones/computers**.

It uses:
- Supabase Auth for email/password sign-in
- Supabase Postgres for shared projects and cards
- Row Level Security (RLS) for access control
- Supabase Realtime Postgres Changes for live board refreshes
- A hard maximum of 2 members per workspace

## 1. Create a Supabase project

Create a Supabase project from the Supabase dashboard.

## 2. Run the database setup

Open:

**Supabase Dashboard → SQL Editor**

Copy everything from:

`supabase_setup.sql`

Paste it into the SQL Editor and run it once.

If the last Realtime lines say a table is already in the publication, you can ignore/skip that individual line.

## 3. Configure the app

Open:

`config.js`

Replace:

`PASTE_YOUR_SUPABASE_PROJECT_URL_HERE`

and

`PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE`

with the Project URL and **Publishable Key** from your Supabase project.

Do NOT use a service_role/secret key in the browser.

## 4. Email confirmation

Supabase may require new users to confirm their email.

For the simplest private two-user setup, you can either:
- keep email confirmation enabled and let both users confirm their email, or
- turn off email confirmation in Supabase Auth settings if you want accounts to work immediately after signup.

## 5. Put the app online

Upload these files together to your web host:

- index.html
- styles.css
- app.js
- config.js

You can use Hostinger, Netlify, Vercel static hosting, GitHub Pages, or another HTTPS static host.

Do not open the deployed app from a `file://` URL when using Supabase. Use a local web server or your hosted HTTPS URL.

## 6. First user

1. Open the website.
2. Click **Create Account**.
3. Sign in.
4. Choose **Create Workspace**.
5. Create the workspace.
6. Open **Settings**.
7. Copy the invite code and send it to User 2.

## 7. Second user

1. Open the same website on their own device.
2. Click **Create Account**.
3. Sign in.
4. Choose **Join Workspace**.
5. Enter the invite code.

The database prevents a third member from joining the workspace.

## What is shared

Both users can:
- create/edit/delete projects
- create/edit/delete cards
- drag cards between To Do / In Progress / Review / Done
- assign cards to either team member
- set priority and due dates
- edit descriptions
- add/check checklist items
- search/filter the board
- see updates from the other user

## Calendar schedules

On the **Calendar** page you can add schedules and events (exhibits, meetings, trips) alongside task due dates:

- **Drag across days** (e.g. Oct 25 → 26), **click + on a day**, or click a day and then **Shift-click** another, to open quick add.
- Choose **Schedule / event** (one bar spanning the dates, with optional time, colour and notes) or **Task card** (a card due on the chosen date).
- Click a schedule bar to edit or delete it. Schedules are shared with both users and update live.

If your database was created before this feature, run `supabase_calendar_events.sql` once in **Supabase Dashboard → SQL Editor**.

## Accomplishment report

The **Reports** page builds each person's accomplishment report in this layout:

| No. | Target Activity | Tasks | Actual Accomplishment |
|-----|-----------------|-------|-----------------------|
| 1 | *project name* | *project description* | • one bullet per card completed in the period |

- **Target activity** is the project name and **Tasks** is the project description, so set your projects up as your work-plan activities (e.g. "Operations Support", "Procurement of components and materials", "Others / Project Matters").
- **Actual accomplishment** lists the cards assigned to that person and completed in the period. Each line of a card's *Accomplishment notes* becomes a bullet; a card without notes uses its title.
- **Period**: 1st–15th, 16th–end of month, whole month, or custom dates.
- **Header & signatories**: upload your logos image, set the program title, your full name and position, and the "Noted by" name and position. Each user has their own.
- Export with **Print / Save PDF**, **Word** (editable) or **CSV**.

If your database was created before this feature, run `supabase_monthly_report.sql` once in **Supabase Dashboard → SQL Editor**. It adds:

- `tasks.completed_at`: set automatically when a card moves to Done, cleared if it's reopened
- `tasks.accomplishment`: the card's "Accomplishment notes"
- `profiles.report_settings`: your report header and signatories

Until you run it, completion dates are estimated from each card's last edit, the notes field is hidden, and the report header is saved only on the device you're using.

Completed cards are hidden from the board. Turn on **Show completed** to see them.

## Security

The browser uses only the Supabase Publishable Key. Database access is protected using Row Level Security policies tied to authenticated users and their workspace membership.

Never place a Supabase service_role or secret key in `config.js`.
