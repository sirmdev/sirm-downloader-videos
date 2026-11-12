import {installCapture} from './capture.mjs';
import {createLessonResolver} from './batch.mjs';
import {createNativeClient} from './native-client.mjs';
import {createDownloadManager} from './downloads.mjs';
import {createCourseRunner} from './course-runner.mjs';
import {installHub} from './hub.mjs';
// MV3: todos os listeners são registrados de forma síncrona no topo; após um await perderiam o evento que acordou o worker.
const capture=installCapture(chrome);
const native=createNativeClient(chrome);
const downloads=createDownloadManager({native});
const course=createCourseRunner({chrome,downloads,native,makeResolver:()=>createLessonResolver(chrome,capture)});
const ready=course.restore();
installHub(chrome,{capture,native,downloads,course,ready});
