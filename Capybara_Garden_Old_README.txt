Capybara Garden - Legacy Package

This archive contains a minimal "Capybara Garden (Old)" package intended for inspection or inclusion into a Unity project.
Files included:
- unity_data/README.txt           -> notes about using the folder in Unity
- unity_data/CapybaraGarden.exe   -> placeholder file (not a real executable)
- unity_data/icon_channels4.jpg   -> original app icon reference (use channels4_profile (4).jpg from assets)
- unity_data/scripts/Player.js    -> JavaScript copy of the Player logic (for reference)
- unity_data/scripts/Enemy.js     -> JavaScript copy of the Enemy logic (for reference)
- unity_data/scripts/World.js     -> JavaScript copy of the World logic (for reference)
- unity_data/scripts/main.js      -> JavaScript copy of the main game orchestration (for reference)

Notes:
- These scripts are copies of the web project source files. They are provided as reference when reimplementing logic in Unity (C#).
- The placeholder CapybaraGarden.exe is not a runnable Windows executable — it is a tiny file useful for packaging/placeholder purposes.
- The recommended icon for packaging is channels4_profile (4).jpg found in the project assets.
- To import into Unity: move the contents of unity_data into your Unity project's Assets/ folder, convert or reimplement gameplay scripts into C# MonoBehaviour scripts, add models and textures into Unity, and set up scenes with lighting and a terrain or plane.
- This package is intended for developers to inspect and port logic; it does not contain a full Unity project (.unitypackage or ProjectSettings).

Authorship:
Capybara Garden Team