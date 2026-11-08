# Greenroom Local User Guide

Write a scene, give each character a voice, direct how every line is played in your own words, make takes, and export the finished audio. This guide follows the shortest path from an empty app to a finished mix.

Screenshots show the demo build, so some voice names and prices will differ on your computer.

## 1. Start a project

Open **Projects**. Type a name and press **New project**, or start from a template (Animation story, Audio horror, Sci-fi and more).

![The Projects screen with the File, Edit, View and Help menus along the top](img/guide-1-projects.jpg)

Your work saves automatically. To come back to it later, choose **File > Open project…** (Ctrl+O) and pick it from the list.

## 2. Write the script

Open **Script**. Write one line per speaker as `NAME: what they say`. Put a direction in brackets after the name, and start a new scene with `# Scene title`. Press **Insert a sample scene** to see the format.

![The Script screen with a sample scene and the characters Greenroom found](img/guide-2-script.jpg)

Greenroom lists the characters it found on the right. Press **Done, choose voices** when you are ready.

## 3. Cast the voices

Open **Cast**. Give every character a voice from your library. **Auto-cast** can suggest a different voice for each character. Anything that downloads shows a confirmation first, and it says plainly that nothing from your project is sent.

![The Auto-cast confirmation listing the voices that will be added](img/guide-4-cast-confirm.jpg)

A voice belongs to one engine (ElevenLabs, VoiceKiller, Kie, Piper and so on), so choosing a voice also chooses the engine. Cloned, designed and library voices all work the same way here.

## 4. Direct each line, in your own words

Open **Perform**. Every line is one card: the speaker and voice, the words, a **Direction** box, quick styles, and one **Make a take** button.

![A Perform line card with written direction, quick style chips and the Make a take button](img/guide-5-perform-direction.jpg)

**Write the direction yourself.** Type how the line should be played, in plain English, up to 400 characters. For example: *Quietly furious, barely holding it together. A long beat before the last word.* You are not limited to a list of tags.

**Or click a style.** Whisper, Angry, Sad, Tired, Sarcastic, Scared, Excited, Villain, Warm and Deadpan each add a full sentence to the box. Click the style again to take it out. Whatever else you wrote stays.

**Or let the AI write it.** Press **Write it for me** (empty box) or **Expand with AI** (a few words typed). It asks for confirmation first because it uses a text model, then puts the result in the box for you to edit. Nothing is spoken until you make a take.

**Or direct the whole scene at once.** Press **Direct whole scene** at the top of Perform. The AI reads your script, including the action and stage directions, and writes a full direction for every line, following each character's feeling through the scene (when it builds, breaks, softens or is hidden). A confirmation shows the size first. Then you get a review list.

![The scene notes review: edit each direction, tick the lines to use, and lines you already directed are left alone](img/guide-8-direct-whole-scene.jpg)

Edit any direction in the list, tick the lines you want, and press **Apply**. Lines where you already wrote a direction are unticked by default. Nothing is spoken or paid for until you make a take. **Direct with AI** (the other button) still suggests short styles, sounds, speed and pauses instead.

**Reuse a good phrase.** The **Recent…** menu remembers your last eight directions.

Greenroom tells you under the box what your voice can do with the direction:

| Voice | What happens to your written direction |
|---|---|
| ElevenLabs (library, designed or cloned) | Acted on. Each sentence is sent as an acting cue before the line. |
| VoiceKiller | Acted on. Sent as a written instruction. |
| Inworld | Acted on with **Inworld TTS 2** (an English instruction in brackets) and laughs, sighs, coughs and breaths as tags. **TTS 2 Flash** does not follow written direction. Anything it cannot do is listed before you pay. See [Inworld](INWORLD.md). |
| Kie, Piper, Chatterbox, Wazobia, your own local server | These engines cannot act on written words. Greenroom says so. Use **Re-voice a recording** to perform the line yourself, or pick an ElevenLabs or VoiceKiller voice. |

**Press Ctrl+Enter** inside the Direction box to make a take without reaching for the mouse.

### Plan the performance (Director panel)

Under **Fine-tune** each line with a voice has a **Director** panel for planning rather than tagging.

![The Director panel: objective, subtext, how the feeling moves, what the body is doing, the voice itself](img/director-panel.jpg)

- **Objective and subtext:** what the character is trying to do, and what is underneath.
- **How the feeling moves:** a feeling and strength at the start of the line and at the end.
- **What the body is doing:** standing, walking, running, lifting, pushing, fighting, hurt, cold or your own description, with effort, breathlessness, fatigue and pain.
- **The voice itself:** pace, projection, tension and breathiness.

Greenroom turns the plan into at most four short plain-English sentences and adds them **after your own direction** when a take is made, and the panel shows exactly what will be added. Very high breathlessness also adds the verified out-of-breath sound. Pace multiplies the line's speed. Your script text, the chips and the Direction box are never changed, and **Clear the plan** removes it. A voice that cannot act on written words (Piper, Chatterbox, Kie and others) can only follow the pace, and the panel says so. Plans are saved with the project; older projects simply have none. They are included in the performance manifest.

This is wording sent to a model that may or may not obey it. Whether the result sounds strained or breathless is for you to judge by ear.

### Fine-tune and More

![The Fine-tune panel open and the More menu showing Make 3 takes, Re-voice a recording and Add a sound clip](img/guide-6-finetune-more.jpg)

- **Fine-tune** holds the extras: situation presets (lifting something heavy, running, crying while talking), every emotion and sound chip, speed, level, pause after, and a preview of exactly what will be sent. Its title names whatever is set.
- **More** holds **Make 3 takes**, **Re-voice a recording** and **Add a sound clip** (a sneeze, a door).
- **Details** on a take shows where it came from, including the direction it was made with.

Play each take, choose **Use this one**, and press **Play the scene** to hear the whole scene. The bottom bar shows how many lines have takes and, once you have spent anything, the estimated cost so far.

### Listen, pause and stop

Everywhere you can hear something, you can also pause it and carry on from the same spot.

![Play the scene paused, with Resume and Stop in the bottom bar](img/guide-7-pause-resume.jpg)

- **Takes, voice samples and sound clips:** press the play button to start, press it again to **Pause**, and again to **Resume**. While paused a small **Stop** button ends it. Starting another sound stops the first.
- **Play the scene:** the bottom bar shows **Pause** or **Resume**, and **Stop**.
- **Listen first** on the Export screen works the same way.
- Longer players (the timeline, the picture preview, and the audio players in voice design and the Voice lab) have their own pause button.

## 5. Export

Open **Export** (or **File > Export audio…**) for a WAV mix, stems per character, a cue sheet and editor handoff files. See [Pro audio](PRO_AUDIO.md).

## Menus and shortcuts

The menu bar sits along the top of the window.

| Menu | What it does |
|---|---|
| **File** | New project (Ctrl+N), Open project (Ctrl+O), Open a backup, Save (Ctrl+S), Save a backup copy (Ctrl+Shift+S), Export audio, Close project (Ctrl+W), Exit (Ctrl+Q) |
| **Edit** | Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), Cut, Copy, Paste, Select all |
| **View** | Jump to Script, Cast, Perform, Timeline, Voice library, Model Center, Voice lab, Settings |
| **Help** | Help and guide, Check for updates, About |

![The File menu](img/guide-3-file-menu.jpg)

Items that need an open project are greyed out until you open one. Projects save as you work, so **Save** is there for peace of mind, and **Save a backup copy** makes a full copy you can reopen later from **File > Open a backup…**.

## Check that your voices follow direction

Open **Voice lab** and press **Written direction check**. It reads one line ten times (five written directions on ElevenLabs v4 and v3) so you can play them side by side and rate them. It shows a confirmation with the character count first, and uses the ElevenLabs key already saved in Settings. Judge by ear: the clips should sound clearly different from the no-direction baseline.

## Inworld voices

Add your Inworld Base64 credential in **Settings**, press **Test Inworld connection**, then find Inworld voices in **Voices, Find a voice** or clone one in **Voices, Clone a voice**. Pick the model in **Engines**. Inworld pricing is not known to Greenroom: enter your own price per 1,000 characters in Studio to see estimates. The full guide, with screenshots and what was and was not tested, is [Inworld](INWORLD.md).

## Keys, cost and privacy

- Keys live in the Windows Credential Manager, never in a project.
- Every paid action shows a confirmation sheet first. Offline engines are free.
- Local voices run on your computer with no internet.

## Help when something fails

- **Help and guide** in the app, or **Help > Help and guide**.
- **Settings** to check a connection or change a key.
- [Getting started](GETTING_STARTED.md) for installing local engines.
