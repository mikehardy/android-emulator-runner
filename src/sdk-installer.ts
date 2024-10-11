import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';

const BUILD_TOOLS_VERSION = '35.0.0';
const CMDLINE_TOOLS_VERSION = '16.0'; // the downloads immediately below should correspond to this version
const CMDLINE_TOOLS_URL_MAC = 'https://dl.google.com/android/repository/commandlinetools-mac-12266719_latest.zip';
const CMDLINE_TOOLS_URL_LINUX = 'https://dl.google.com/android/repository/commandlinetools-linux-12266719_latest.zip';

/**
 * Installs & updates the Android SDK for the macOS platform, including SDK platform for the chosen API level, latest build tools, platform tools, Android Emulator,
 * and the system image for the chosen API level, CPU arch, and target.
 */
export async function installAndroidSdk(apiLevel: string, target: string, arch: string, channelId: number, emulatorBuild?: string, ndkVersion?: string, cmakeVersion?: string): Promise<void> {
  try {
    console.log(`::group::Install Android SDK`);
    const isOnMac = process.platform === 'darwin';
    const isArm = process.arch === 'arm64';

    if (!isOnMac) {
      await exec.exec(`sh -c "sudo chown $USER:$USER ${process.env.ANDROID_HOME}"`);
      await exec.exec(`sh -c "sudo chown -R $USER:$USER ${process.env.ANDROID_HOME}/platform-tools || true"`);
      await exec.exec(`sh -c "sudo chown -R $USER:$USER ${process.env.ANDROID_HOME}/cmdline-tools/latest || true"`);
      await exec.exec(`sh -c "sudo chown -R $USER:$USER ${process.env.ANDROID_HOME}/build-tools/${BUILD_TOOLS_VERSION} || true"`);
    }

    const cmdlineToolsPath = `${process.env.ANDROID_HOME}/cmdline-tools`;

    // it may happen that cmdlineToolsPath exists, but is older than desired
    if (fs.existsSync(cmdlineToolsPath)) {
      const cmdlineToolsVer = (await exec.getExecOutput(`sh -c "${cmdlineToolsPath}/latest/bin/sdkmanager --version"`)).stdout.trim();
      if (!cmdlineToolsVer.includes(CMDLINE_TOOLS_VERSION)) {
        console.log(`latest cmdline-tools is version ${cmdlineToolsVer} instead of ${CMDLINE_TOOLS_VERSION}. Removing.`);
        await exec.exec(`sh -c \\"rm -fr ${cmdlineToolsPath}/latest"`);
      } else {
        console.log(`latest cmdline-tools is expected version ${CMDLINE_TOOLS_VERSION}: "${cmdlineToolsVer}"`);
      }
    }

    if (!fs.existsSync(`${cmdlineToolsPath}/latest`)) {
      console.log('Installing new cmdline-tools.');
      const sdkUrl = isOnMac ? CMDLINE_TOOLS_URL_MAC : CMDLINE_TOOLS_URL_LINUX;
      const downloadPath = await tc.downloadTool(sdkUrl);
      await tc.extractZip(downloadPath, cmdlineToolsPath);
      await io.mv(`${cmdlineToolsPath}/cmdline-tools`, `${cmdlineToolsPath}/latest`);
    }

    // add paths for commandline-tools and platform-tools
    core.addPath(`${cmdlineToolsPath}/latest:${cmdlineToolsPath}/latest/bin:${process.env.ANDROID_HOME}/platform-tools`);

    // set standard AVD home and path variables
    core.exportVariable('ANDROID_USER_HOME', `${process.env.HOME}/.android`);
    core.exportVariable('ANDROID_EMULATOR_HOME', process.env.ANDROID_USER_HOME);
    core.exportVariable('ANDROID_AVD_HOME', `${process.env.ANDROID_EMULATOR_HOME}/avd`);

    // accept all Android SDK licenses
    await exec.exec(`sh -c \\"yes | sdkmanager --licenses > /dev/null"`);

    console.log('Installing latest build tools, platform tools, and platform.');

    await exec.exec(`sh -c \\"sdkmanager --install 'build-tools;${BUILD_TOOLS_VERSION}' platform-tools 'platforms;android-${apiLevel}'> /dev/null"`);

    console.log('Installing latest emulator.');
    await exec.exec(`sh -c \\"sdkmanager --install emulator --channel=${channelId} > /dev/null"`);

    if (emulatorBuild) {
      console.log(`Installing emulator build ${emulatorBuild}.`);
      // TODO find out the correct download URLs for all build ids
      var downloadUrlSuffix: string;
      const majorBuildVersion = Number(emulatorBuild);
      if (majorBuildVersion >= 8000000) {
        if (isArm) {
          downloadUrlSuffix = `_aarch64-${emulatorBuild}`;
        } else {
          downloadUrlSuffix = `_x64-${emulatorBuild}`;
        }
      } else if (majorBuildVersion >= 7000000) {
        downloadUrlSuffix = `_x64-${emulatorBuild}`;
      } else {
        downloadUrlSuffix = `-${emulatorBuild}`;
      }
      await exec.exec(`curl -fo emulator.zip https://dl.google.com/android/repository/emulator-${isOnMac ? 'darwin' : 'linux'}${downloadUrlSuffix}.zip`);
      await exec.exec(`unzip -o -q emulator.zip -d ${process.env.ANDROID_HOME}`);
      await io.rmRF('emulator.zip');
    }
    console.log('Installing system images.');
    await exec.exec(`sh -c \\"sdkmanager --install 'system-images;android-${apiLevel};${target};${arch}' --channel=${channelId} > /dev/null"`);

    if (ndkVersion) {
      console.log(`Installing NDK ${ndkVersion}.`);
      await exec.exec(`sh -c \\"sdkmanager --install 'ndk;${ndkVersion}' --channel=${channelId} > /dev/null"`);
    }
    if (cmakeVersion) {
      console.log(`Installing CMake ${cmakeVersion}.`);
      await exec.exec(`sh -c \\"sdkmanager --install 'cmake;${cmakeVersion}' --channel=${channelId} > /dev/null"`);
    }
  } finally {
    console.log(`::endgroup::`);
  }
}
