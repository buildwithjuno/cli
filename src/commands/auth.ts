import {Ed25519KeyIdentity} from '@dfinity/identity';
import {JsonnableEd25519KeyIdentity} from '@dfinity/identity/lib/cjs/identity/ed25519';
import fs from 'fs';
import http, {createServer} from 'http';
import {bold, green, underline} from 'kleur';
import path from 'path';
import util from 'util';
import {AUTH_URL} from '../constants/constants';
import {nextArg} from '../utils/args.utils';
import {clearAuthConfig, saveAuthConfig} from '../utils/auth.config.utils';
import {authUrl, requestUrl} from '../utils/auth.utils';
import {openUrl} from '../utils/open.utils';
import {getPort} from '../utils/port.utils';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const logout = async () => {
  clearAuthConfig();

  console.log(`${green('Logged out')}`);
};

export const login = async (args?: string[]) => {
  const port = await getPort();
  const nonce = Math.floor(Math.random() * (2 << 29) + 1);

  const key = Ed25519KeyIdentity.generate();
  const principal = key.getPrincipal().toText();
  const token = key.toJSON(); // save to local

  const profile = nextArg({args, option: '-u'}) ?? nextArg({args, option: '--use'});

  return new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(requestUrl({port, reqUrl: req.url}));
      const returnedNonce = url.searchParams.get('state');
      const satellites = url.searchParams.get('satellites');
      const missionControl = url.searchParams.get('mission_control');

      if (returnedNonce !== `${nonce}`) {
        await respondWithFile(req, res, 400, '../templates/failure.html');
        reject(new Error('Unexpected error while logging in.'));
        server.close();
        return;
      }

      try {
        saveConfig({token, satellites, missionControl, profile});
        await respondWithFile(req, res, 200, '../templates/success.html');
        console.log(`${green('Success!')} Logged in`);
        resolve();
      } catch (err) {
        // TODO: another error page
        console.error(err);
        await respondWithFile(req, res, 400, '../templates/failure.html');
        reject(err);
      }

      server.close();
      return;
    });

    server.listen(port, async () => {
      console.log();
      console.log('Visit this URL on this device to log in:');
      console.log(bold(underline(AUTH_URL)));
      console.log();
      console.log('Waiting for authentication...');

      await openUrl(authUrl({port, nonce, principal}));
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
};

async function respondWithFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  statusCode: number,
  filename: string
) {
  const response = await util.promisify(fs.readFile)(path.join(__dirname, filename));
  res.writeHead(statusCode, {
    'Content-Length': response.length,
    'Content-Type': 'text/html'
  });
  res.end(response);
  req.socket.destroy();
}

const saveConfig = ({
  token,
  satellites,
  missionControl,
  profile
}: {
  token: JsonnableEd25519KeyIdentity;
  satellites: string | null;
  missionControl: string | null;
  profile?: string;
}) => {
  saveAuthConfig({
    token,
    satellites: JSON.parse(decodeURIComponent(satellites ?? '[]')),
    missionControl,
    profile
  });
};
