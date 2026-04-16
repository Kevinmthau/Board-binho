namespace BoardBinho.EditorTools
{
    using System.IO;

    using UnityEditor.Build;
    using UnityEditor;
    using UnityEditor.Build.Reporting;

    public static class BinhoBuild
    {
        public const string ApkPath = "Builds/Android/BoardBinho.apk";

        [MenuItem("Binho/Build Android APK")]
        public static void BuildAndroidApk()
        {
            BinhoProjectBootstrap.BootstrapProject();

            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
            {
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);
            }

            Directory.CreateDirectory(Path.GetDirectoryName(ApkPath) ?? "Builds/Android");

            var report = BuildPipeline.BuildPlayer(
                new[]
                {
                    BinhoProjectBootstrap.ScenePath,
                },
                ApkPath,
                BuildTarget.Android,
                BuildOptions.None);

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException("Android build failed for Board Binho.");
            }
        }

        public static void BuildAndroidApkFromCommandLine()
        {
            BuildAndroidApk();
        }
    }
}
