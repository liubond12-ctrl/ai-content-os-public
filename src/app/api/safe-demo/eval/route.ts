import {evalPreview} from "../../../../studio/eval-demo";
export function GET(){return Response.json(evalPreview(),{headers:{"Cache-Control":"no-store"}});}
