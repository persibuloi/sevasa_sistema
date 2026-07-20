import 'dotenv/config';
import { app } from './aplicacion';

const puerto = Number(process.env.PUERTO ?? 3001);
app.listen(puerto, () => {
  console.log(`🚀 sevasa-contable backend en http://localhost:${puerto}`);
});
