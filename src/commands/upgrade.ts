import {
  SatelliteParameters,
  satelliteVersion,
  upgradeSatellite as upgradeSatelliteAdmin
} from '@junobuild/admin';
import {red, yellow} from 'kleur';
import prompts from 'prompts';
import {coerce, compare, major, minor, patch} from 'semver';
import {SATELLITE_WASM_NAME} from '../constants/constants';
import {hasArgs, nextArg} from '../utils/args.utils';
import {GitHubAsset, GitHubRelease, githubReleases} from '../utils/github.utils';
import {junoConfigExist, readSatelliteConfig} from '../utils/satellite.config.utils';
import {satelliteKey, satelliteParameters} from '../utils/satellite.utils';
import {upgradeWasmGitHub, upgradeWasmLocal} from '../utils/wasm.utils';

export const upgrade = async (args?: string[]) => {
  if (hasArgs({args, options: ['-m', '--mission-control']})) {
    return;
  }

  await upgradeSatellite(args);
};

const upgradeMissionControl = async (args?: string[]) => {};

const upgradeSatellite = async (args?: string[]) => {
  if (!(await junoConfigExist())) {
    console.log(`${red('No configuration found.')}`);
    return;
  }

  const {satelliteId} = await readSatelliteConfig();

  const satellite = satelliteParameters(satelliteId);

  if (hasArgs({args, options: ['-s', '--src']})) {
    await upgradeSatelliteCustom({satellite, args});
    return;
  }

  await upgradeSatelliteRelease(satellite);
};

const promptReleases = async (
  githubReleases: GitHubRelease[]
): Promise<GitHubAsset | undefined> => {
  const choices = githubReleases.reduce((acc, {tag_name, assets}: GitHubRelease) => {
    const asset = assets?.find(({name}) => name.includes(SATELLITE_WASM_NAME));
    const title = `Juno ${tag_name} (${asset?.name ?? ''})`;

    return [...acc, ...(asset !== undefined ? [{title, value: asset}] : [])];
  }, [] as {title: string; value: GitHubAsset}[]);

  const {asset} = await prompts({
    type: 'select',
    name: 'asset',
    message: 'Which release should be used to upgrade your satellite?',
    choices,
    initial: 0
  });

  // In case of control+c
  if (asset === undefined) {
    process.exit(1);
  }

  return asset;
};

const checkVersion = ({
  currentVersion,
  selectedVersion,
  displayHint
}: {
  currentVersion: string;
  selectedVersion: string;
  displayHint: string;
}): {canUpgrade: boolean} => {
  const currentMajor = major(currentVersion);
  const selectedMajor = major(selectedVersion);
  const currentMinor = minor(currentVersion);
  const selectedMinor = minor(selectedVersion);
  const currentPath = patch(currentVersion);
  const selectedPath = patch(selectedVersion);

  if (
    currentMajor < selectedMajor - 1 ||
    currentMinor < selectedMinor - 1 ||
    currentPath < selectedPath - 1
  ) {
    console.log(
      `There may have been breaking changes your ${displayHint} ${yellow(
        `v${currentVersion}`
      )} and selected version ${yellow(`v${selectedVersion}`)}.\nPlease upgrade iteratively.`
    );

    return {canUpgrade: false};
  }

  return {canUpgrade: true};
};

const upgradeSatelliteRelease = async (satellite: SatelliteParameters) => {
  const currentVersion = await satelliteVersion({
    satellite
  });

  const releases = await githubReleases();

  if (releases === undefined) {
    console.log(`${red('Cannot fetch GitHub repo releases 😢.')}`);
    return;
  }

  const releasesWithAssets = releases.filter(
    ({assets}) => assets?.find(({name}) => name.includes(SATELLITE_WASM_NAME)) !== undefined
  );

  if (releasesWithAssets.length === 0) {
    console.log(`${red('No assets has been released. Reach out Juno❗')}`);
    return;
  }

  const newerReleases = releasesWithAssets.filter(({assets}) => {
    const asset = assets?.find(({name}) => name.includes(SATELLITE_WASM_NAME));

    if (asset === undefined) {
      return false;
    }

    const version = coerce(asset.name)?.format();

    if (version === undefined) {
      return false;
    }

    return compare(currentVersion, version) === -1;
  });

  if (newerReleases.length === 0) {
    console.log(`No newer releases are available at the moment.`);
    return;
  }

  const asset = await promptReleases(newerReleases);

  if (asset === undefined) {
    console.log(`${red('No asset has been released for the selected version. Reach out Juno❗️')}`);
    return;
  }

  const selectedVersion = coerce(asset.name)?.format();

  if (selectedVersion === undefined) {
    console.log(`${red('No version can be extracted from the asset. Reach out Juno❗️')}`);
    return;
  }

  const displayHint = `satellite "${satelliteKey(satellite.satelliteId ?? '')}"`;
  const {canUpgrade} = checkVersion({displayHint, currentVersion, selectedVersion});

  if (!canUpgrade) {
    return;
  }

  const upgradeSatelliteWasm = async ({wasm_module}: {wasm_module: Array<number>}) =>
    upgradeSatelliteAdmin({
      satellite,
      wasm_module
    });

  await upgradeWasmGitHub({asset, upgrade: upgradeSatelliteWasm});
};

const upgradeSatelliteCustom = async ({
  satellite,
  args
}: {
  satellite: SatelliteParameters;
  args?: string[];
}) => {
  const src = nextArg({args, option: '-s'}) ?? nextArg({args, option: '--src'});

  if (src === undefined) {
    console.log(`${red('No source file provided.')}`);
    return;
  }

  const upgradeSatelliteWasm = async ({wasm_module}: {wasm_module: Array<number>}) =>
    upgradeSatelliteAdmin({
      satellite,
      wasm_module
    });

  await upgradeWasmLocal({src, upgrade: upgradeSatelliteWasm});
};
