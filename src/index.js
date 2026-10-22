'use strict';
/**
 * DTunnel - servidor gRPC (Node.js) + painel web de edicao de configs.
 *
 *   node src/index.js                # gRPC em :443  e painel em :4000
 *   GRPC_PORT=18443 node src/index.js
 *   DT_PANEL_PORT=9090 node src/index.js
 */
const { startGrpc } = require('./grpc-server');
const { startPanel } = require('./panel');
const { ReplySigner } = require('./signer');
const data = require('./data');

const GRPC_PORT = process.env.GRPC_PORT || '443';
const PANEL_PORT = process.env.DT_PANEL_PORT || '4000';

async function main() {
  console.log('[boot] dados em', data.DATA_DIR);

  const signer = new ReplySigner(null, data.SERVER_DIR);
  startGrpc({ port: GRPC_PORT, signer });
  await startPanel({ port: PANEL_PORT });

  const shutdown = () => {
    console.log('\n[boot] encerrando...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[boot] erro fatal:', e);
  process.exit(1);
});
