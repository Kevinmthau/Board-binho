namespace BoardBinho.EditorTools
{
    using BoardBinho;

    using Board.Input;

    using UnityEditor.Build;
    using UnityEditor;
    using UnityEditor.SceneManagement;
    using UnityEngine;
    using UnityEngine.EventSystems;
    using UnityEngine.SceneManagement;

    public static class BinhoProjectBootstrap
    {
        public const string PackageId = "com.defaultcompany.boardbinho";
        public const string ScenePath = "Assets/Scenes/BinhoBoard.unity";

        [MenuItem("Binho/Bootstrap Project")]
        public static void BootstrapProject()
        {
            ApplyBoardDefaults();
            CreateOrUpdateScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        public static void BootstrapProjectFromCommandLine()
        {
            BootstrapProject();
        }

        public static void ApplyBoardDefaults()
        {
            PlayerSettings.productName = "Board Binho";
            PlayerSettings.companyName = "DefaultCompany";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, PackageId);
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel33;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel33;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.allowedAutorotateToPortrait = false;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.allowedAutorotateToLandscapeLeft = true;
            PlayerSettings.allowedAutorotateToLandscapeRight = false;
            PlayerSettings.useAnimatedAutorotation = false;
        }

        public static void CreateOrUpdateScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "BinhoBoard";

            var cameraObject = new GameObject("Main Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 5.5f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.9f, 0.93f, 0.91f);
            cameraObject.tag = "MainCamera";
            cameraObject.transform.position = new Vector3(0f, 0f, -10f);
            cameraObject.AddComponent<AudioListener>();

            var eventSystemObject = new GameObject("EventSystem");
            eventSystemObject.AddComponent<EventSystem>();
            var boardUiModule = eventSystemObject.AddComponent<BoardUIInputModule>();
            boardUiModule.forceModuleActive = true;

            var gameRoot = new GameObject("Binho Game");
            var controller = gameRoot.AddComponent<BinhoGameController>();

            var cameraField = typeof(BinhoGameController).GetField("m_WorldCamera", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            cameraField?.SetValue(controller, camera);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }
    }
}
