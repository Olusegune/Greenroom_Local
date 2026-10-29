# Greenroom Local Getting Started

Greenroom Local is a desktop studio for writing dialogue, choosing voices, directing performances, placing sound effects and exporting a mix. The project, takes and downloaded local assets stay on the computer unless a selected cloud engine is used.

## Install the app

1. Run `Greenroom Local - Guided Setup Installer.exe`.
2. Accept the per-user installation. It does not require an administrator password.
3. Launch Greenroom Local from the Start menu or desktop shortcut. The installer and app use the Greenroom icon.

If Windows shows an unfamiliar-publisher warning, that is a Windows reputation/code-signing warning, not an instruction from Greenroom. The current release is not Authenticode-signed. Obtain installers only from the Greenroom release folder or the project's GitHub release.

## Make a first project

1. Select **Projects**, then create a project.
2. Open **Script** and enter dialogue as `NAME: dialogue`. Use `# Scene title` for scene headings.
3. Open **Voices**. Start with **Explore voices** to preview and add an offline Piper voice, or connect a cloud account in **Settings**.
4. Open **Cast** and assign a voice to each character.
5. Open **Perform** to direct the line, make a take and choose the one to use.
6. Open **Export** for a WAV mix, stems, cue sheet or other handoff files.

## Local voices without a terminal

On the Model Center screen, choose **Install Piper** and then open the voice library. Adding a Piper voice downloads the speech engine if needed and stores its voice data in Greenroom's local area. No Python, command prompt or model folder management is required.

Chatterbox has an in-app runtime installer and a verified model-file download. It is the current advanced local speech path. Its built-in voice is plain English speech; advanced acting and cloning controls are not presented as working until they are connected and listening-tested.

## WazobiaVoice

Choose **Install automatically** on the Wazobia card after downloading `t3_mtl23ls_v2.safetensors`. Greenroom checks the Desktop and Downloads folders, then copies the model weight into its managed model storage without changing the original file. If it is elsewhere, use **Choose model file**.

This stores the model safely, but it does not yet make WazobiaVoice speak: a tested local inference runtime is still required. Greenroom labels this distinction in the app so a model file is never mistaken for a ready voice engine. Check the Axiveri licence before commercial use.

## Connect cloud engines only when wanted

Open **Settings** to add a key for ElevenLabs, Kie, VoiceKiller or a Hugging Face token. Keys are stored by the desktop credential system, not in projects. A paid or cloud action always shows a confirmation before it runs.

- **ElevenLabs** supplies expressive speech, voice design, cloning and Sound Effects v3.
- **Kie** supplies the current AI Director and optional cloud sound/music routes.
- **Hugging Face** tokens are for models that require account access. Greenroom asks for one only when needed.

## Sound Effects v3

Open **SFX Studio** in the left rail. Describe the sound, choose a script line and timing, then select **Generate and place**. With ElevenLabs selected in **Engines**, Sound Effects v3 is the default and supports duration, looping and prompt influence. The resulting take remains attached to the selected line and is available on the Timeline and in export.

## Help when something fails

- Use **Help and guide** in the app for task-oriented help.
- Use **Settings** to check a cloud connection or change keys.
- Use **Engines** to see which engine is selected for speech and sound.
- Read the actual error message before trying again. A missing permission or account-plan limit cannot be fixed by repeatedly pressing a button.

Never add or clone a real person's voice without their permission and an appropriate right to use it.
