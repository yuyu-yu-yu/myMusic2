using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class CanCanSfx
{
    [STAThread]
    private static int Main()
    {
        string runRoot = CreateShortRunRoot();
        try
        {
            string payloadPath = Path.Combine(runRoot, "payload.zip");
            ExtractEmbeddedResource("payload.zip", payloadPath);
            ZipFile.ExtractToDirectory(payloadPath, runRoot);

            string nodePath = Path.Combine(runRoot, "runtime", "node.exe");
            string launcherPath = Path.Combine(runRoot, "launcher", "launch-release.mjs");
            if (!File.Exists(nodePath))
            {
                throw new FileNotFoundException("Bundled node.exe was not found after extraction.", nodePath);
            }
            if (!File.Exists(launcherPath))
            {
                throw new FileNotFoundException("Release launcher was not found after extraction.", launcherPath);
            }

            using (Process launcher = Process.Start(new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = Quote(launcherPath),
                WorkingDirectory = runRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            }))
            {
                if (launcher == null)
                {
                    throw new InvalidOperationException("Failed to start CanCan Campus Radio.");
                }
                launcher.WaitForExit();
                return launcher.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "CanCan Campus Radio could not start.\r\n\r\n" + ex.Message,
                "CanCan Campus Radio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            TryDelete(runRoot);
        }
    }

    private static string CreateShortRunRoot()
    {
        string suffix = Guid.NewGuid().ToString("N").Substring(0, 8);
        string[] roots = new string[]
        {
            Path.Combine(Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\", "CCR-" + suffix),
            Path.Combine(Path.GetTempPath(), "CCR-" + suffix)
        };

        foreach (string candidate in roots)
        {
            try
            {
                Directory.CreateDirectory(candidate);
                return candidate;
            }
            catch
            {
                // Try the next writable root.
            }
        }

        throw new IOException("Could not create a short writable extraction directory.");
    }

    private static void ExtractEmbeddedResource(string resourceName, string outputPath)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream input = assembly.GetManifestResourceStream(resourceName))
        {
            if (input == null)
            {
                throw new InvalidOperationException("Embedded payload was not found: " + resourceName);
            }
            using (FileStream output = File.Create(outputPath))
            {
                input.CopyTo(output);
            }
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch
        {
            // Best-effort cleanup only. Browser profile locks can outlive process exit briefly.
        }
    }
}
