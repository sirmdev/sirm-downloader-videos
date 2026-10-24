import {installCapture} from './capture.mjs';
import {installBatch} from './batch.mjs';
const capture=installCapture(chrome);
installBatch(chrome,capture);
