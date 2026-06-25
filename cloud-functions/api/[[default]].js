import { handleEdgeOneRequest } from '../../server/edgeone-api.mjs';

export default function onRequest(context) {
  return handleEdgeOneRequest(context);
}
