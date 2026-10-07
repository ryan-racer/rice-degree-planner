# DegreePlanner

[![Live Demo](https://img.shields.io/badge/Live_Demo-00205B?style=for-the-badge&logo=github&logoColor=white)](https://ryan-racer.github.io/rice-degree-planner/)

**[Try the live demo](https://ryan-racer.github.io/rice-degree-planner/)** — upload your ESTHER transcript and audit your degree in the browser.

> Rice-branded copy: Rice Blue header and accents with serif display type, a GPA tile with what-if grades, a one-click advising summary, and quick links to ESTHER and the General Announcements.

A front-end-only degree audit and program explorer. Drop in your transcript
and it shows, DegreeWorks-style, how close you are to finishing your declared
major(s), then ranks every other major and minor by how close you already are.

Everything runs in the browser. Nothing is uploaded to a server.

## Run it

Any static file server works (ES modules and the PDF reader need `http://`, not `file://`).
The included dev server also disables browser caching, so edits show up on a normal reload:

```bash
python3 serve.py 8080
```

Then open <http://localhost:8080/>. Add `--lan` to let other devices on your network connect via your machine's IP address.
On a Mac, `tools/install-launchd.sh` installs a user agent that keeps the LAN server running across logins and
terminal sessions (`tools/install-launchd.sh --remove` uninstalls it).
Deploy the folder as-is to GitHub Pages, Netlify, Cloudflare Pages, etc.

## Offline

`sw.js` is a small service worker: every request goes to the network first and falls back to the cache, so the app is
always current when online and still opens offline once it has been visited. It registers only over http(s).

## Styling

The UI uses Tailwind CSS v4, compiled ahead of time so the deployed site stays static:

```bash
npm install
npm run build     # css/input.css -> css/app.css
npm run watch     # rebuild on change while editing
```

`css/app.css` is committed, so you only need Node when changing styles or markup.

## Using it

1. Drop your unofficial transcript PDF on the page, or copy the text of your transcript page and paste it anywhere on the site. Any text containing course codes (`COMP 140`) works, including DegreeWorks exports ("still needed" lines are skipped).
2. Check the parsed course list. Edit codes, hours, or status, remove courses, or add ones that are missing.
3. Your declared major is picked up from the transcript when it is listed. Add or remove programs to audit in detail.
4. The explorer ranks all remaining programs by completion. Expand any card for a requirement-by-requirement breakdown.
5. Plan ahead: add future terms and the courses you intend to take. Planned courses count in every audit (marked as planned), and the sidebar suggests the courses that would close the most open requirements in your declared programs.
6. Hover or tap any course code for its description, prerequisites, credit hours, and which recent semesters it was offered.
7. Auto-plan (Planner tab) builds a term-by-term plan for what your declared programs still require. It predicts offering seasons from history (and uses real section data when a term has it), honours prerequisites and plans a missing one only when nothing else can progress, schedules courses that unlock others first, holds senior design and capstones to the final year, balances load up to your graduation target under the hours cap (18 maximum), and adds placeholders for choices only you can make (pattern electives, distribution groups). Every auto-planned course explains itself on hover, and the summary says whether the plan reaches the degree's hour total. Planned courses sitting in a season they do not usually run are flagged.
8. Substitute: on any open requirement of a declared program, count one of your own courses there. Use it for advisor-approved substitutions the catalog cannot know about; each is tagged "manual" and can be undone.
9. Export downloads a JSON backup of everything (courses, programs, plan, schedule). Drop it on the import screen on any device to restore.
10. Schedule tab: pick sections for a term from real meeting times, see them on a weekly grid with conflicts flagged, and search for sections that fit your open slots and fill a requirement or a distribution group. The Schedule and Planner stay in sync both ways for future terms: planned courses get a section picked for them (switchable), and removing either side removes the other, and "Add to calendar" exports them as an .ics file with weekly recurring events.

Audits are estimates, not an official certification. They cover program requirements, the university-wide requirements
(hours toward your degree's actual total, 48 upper-level hours, FWIS, LPAP, distribution with the two-department rule,
Analyzing Diversity), rules that span sections, and advisor-approved substitutions you enter with Substitute.

**Catalog years.** Requirements follow the catalog of the year you matriculated. The year selector in the header
defaults from your first term. For older years the current definitions are adjusted mechanically (course options that
existed then are restored, and programs whose counting changed are flagged); ECE and CS have exact per-year definitions
under `js/schools/rice/variants/`.

## Development

```bash
npm install
npm run check     # regenerate the program bundle, validate every program file, smoke test, unit tests
npm test          # unit tests only (parser, engine, prerequisites, planner, degree audit)
npm run build     # compile css/input.css -> css/app.css
node tools/diff-catalog.mjs <crawl-dir>   # compare program files with a fresh catalog extraction
```

CI runs the same checks on every push. A weekly workflow re-crawls the catalog and schedule and commits refreshed data
when everything passes. `.github/workflows/deploy.yml` publishes to GitHub Pages once you set the repository variable
`ENABLE_PAGES=true` (private repositories need a paid plan for Pages; any static host works, since nothing is built at
deploy time).

## Layout

```
index.html                 page shell
css/input.css              Tailwind source (theme, component classes)
css/app.css                compiled stylesheet (generated by `npm run build`)
js/app.js                  shell: header, import, tabs, Audit tab, boot
js/core.js                 shared state, persistence, catalog year, helpers
js/import/declared.js      matches transcript program names to definitions
js/ui/timeline.js          Planner tab: timeline, editing, drag and drop, auto-plan
js/ui/overview.js          university requirements strip
js/ui/undo.js              one-step undo toast
js/ui/placeholder.js       concrete suggestions for plan placeholders
js/engine/degree.js        university-wide graduation requirements
js/ui/render.js            audit cards → HTML
js/ui/coursecard.js        hover card with course details and offering history
js/ui/autocomplete.js      course code / title autocomplete for add-course inputs
js/ui/schedule.js          semester schedule: weekly grid, section search, plan sync
js/engine/audit.js         requirement evaluation engine (incl. manual substitutions)
js/engine/autoplan.js      auto-planner: offering seasons, prerequisites, hours cap
js/engine/match.js         course-code normalisation and matching
js/parser/transcript.js    transcript text → courses
js/parser/pdf.js           PDF → text (pdf.js from CDN, loaded on demand)
js/schools/index.js        school registry
js/schools/rice/           Rice University data
  index.js                 school metadata + parser hints
  programs/*.js            one file per major / minor
  programs/index.js        generated list of programs
  programs.bundle.js       generated: every program in one module (what the browser loads)
  variants/<year>/*.js     exact definitions for a specific catalog year
  catalog-years.js         generated overlays for archived catalog years
  crosslist.js             generated cross-listing map
  catalog.js               generated course titles and credit hours
  sample.js                sample transcript text
  schedule.js              generated list of term codes covered by offering data
data/rice/courses/*.json   generated per-department course details (loaded on demand)
data/rice/schedule/*.json  generated per-term sections with meeting times (loaded on demand)
docs/PROGRAM_FORMAT.md     how to write a program definition
tests/                     unit tests (node --test)
tools/                     validator, smoke test, catalog diff, crawler, and generators
```

## Adding programs or schools

Read [docs/PROGRAM_FORMAT.md](docs/PROGRAM_FORMAT.md). In short:

* Add a program: create `js/schools/rice/programs/<slug>.js`, then run
  `node tools/gen-index.mjs rice` and `node tools/validate.mjs`.
* Add a school: create `js/schools/<id>/index.js` exporting the same shape as
  `js/schools/rice/index.js` (programs, optional crosslist/catalog/sample and
  transcript parser hints), then list it in `js/schools/index.js`.

### University policies

University-wide rules live in the school's `degree` block, so another school only needs different values:

| Key | Rice value | Rule |
| --- | --- | --- |
| `hours`, `upperLevelHours`, `upperLevel` | 120, 48, 300 | total hours (a program's `degreeHours` can raise it) and hours at the 300 level or above |
| `residency` | 60 hours, 25 upper-level | hours that must be earned at the school itself (not transfer credit) |
| `minGpa`, `programMinGpa` | 1.67, 2.00 | cumulative GPA, and GPA across the courses applied to a major or minor |
| `transferMinHours` | 2.5 | a transferred equivalent meets a general education rule with this many hours instead of the usual minimum |
| `hourCaps` | LPAP 4, student-taught COLL 3 | hours beyond the cap do not count toward the degree |
| `writing`, `activity`, `diversity` | FWIS except FWIS 100; LPAP 100-199 or 238; any AD course of 3+ hours | single-course requirements |
| `distribution` | 3 courses of 3+ hours per group, 2+ departments, never FWIS | distribution groups |
| `passFailGrades` (school level) | `['P']` | Pass/Fail grades: the course still counts toward a major or minor (the Registrar uncovers the grade by the final audit), with a notice |
| `transcript.generic` | `/^TRAN \d/` | placeholder codes for transfer credit with no equivalent: every row counts toward total hours only |

A course passed twice earns credit once unless its catalog description says it is repeatable for credit. Both
attempts stay in the GPA. Distribution and diversity designations come from the current catalog; the rule that a
course must carry the designation in the semester it was taken cannot be checked from a transcript.

## Refreshing the Rice data

Everything generated (catalog, cross-listings, course details, section times) comes from the General Announcements
at <https://ga.rice.edu/> and the course schedule at <https://courses.rice.edu/>. To refresh for a new term:

```bash
tools/refresh-rice-data.sh /tmp/rice-crawl 202710 202720
```

It crawls into the work directory, regenerates the data modules, and runs the validator and smoke test. Program
definition files under `js/schools/rice/programs/` are hand-authored and are not overwritten; the crawl leaves
`raw/<slug>.json` in the work directory so catalog changes can be checked against them.
