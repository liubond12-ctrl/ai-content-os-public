import Cockpit from "@/components/Cockpit";
import {workOverview} from "@/studio/work-overview";
export const dynamic="force-dynamic";
export default function Page(){return <Cockpit initial={workOverview()}/>;}
