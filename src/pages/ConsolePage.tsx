
import StreamingAvatar, { AvatarQuality, StreamingEvents, TaskType, VoiceEmotion } from "@heygen/streaming-avatar";

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;

const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Zap } from 'react-feather';
import { Button } from '../components/button/Button';

import './ConsolePage.scss';
import axios from 'axios';

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
    prompt('OpenAI API Key') ||
    '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );

  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
          apiKey: apiKey,
          dangerouslyAllowAPIKeyInBrowser: true,
        }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [isConversationEnded, setIsConversationEnded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [report, setReport] = useState<string | null>(null); // Estado para el informe
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});

  // Función para generar el informe con la transcripción
  const generateReport = async (transcription: string) => {
    const prompt = `Genera un informe de esta conversación de entrevista de trabajo: \n${transcription} para ver si califica para el cargo y al final puntualo del 1/10`;

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: prompt
            },
          ]
        },
        {
          headers: {
            "Authorization": `Bearer `,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(response.data); // Ver el resultado completo
      if (response.data) {
        const generatedReport = response.data.choices[0].message.content;
        setReport(generatedReport); // Almacenar el informe
        return generatedReport;
      }
    } catch (error) {
      console.error("Error al obtener el análisis:", error);
      return null;
    }
  };

  // Función para descargar el informe como archivo de texto
  const downloadReport = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Simular el clic para iniciar la descarga
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Limpiar: eliminar el enlace y liberar la URL
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  /*----------------------
        API DE HEYGEN
  -----------------------*/
  // Obtener el token de acceso para HeyGen
  async function fetchAccessToken(): Promise<string> {
    try {
      const response = await fetch(
        'https://api.heygen.com/v1/streaming.create_token', {
        method: 'POST',
        headers: {
          "x-api-key": " ",
        }
      }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error al obtener el token:", errorData);
        throw new Error(`Error: ${errorData.error || "No autorizado"}`);
      }
      const data = await response.json();
      console.log("data", data.data.token);
      return data.data.token;
    } catch (error) {
      console.error("Error al obtener el token:", error);
      throw error; // Relanzar el error para manejarlo en otros contextos
    }
  }

  async function fetchInterrupTexto(): Promise<string> {
    try {
      const response = await fetch("https://api.heygen.com/v1/streaming.interrupt", {
        method: "POST",
        headers: {
          "x-api-key": " ",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session_id: sessionData.session_id,
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error al obtener el texto:", errorData);
        throw new Error(`Error: ${errorData.error || "No autorizado"}`);
      }

      const data = await response.json();
      return data.text;
    } catch (error) {
      console.error("Error en la solicitud del texto:", error);
      throw error;
    }
  }

  //CREAR EL AVATAR
  async function createStreamingSession(token: string) {
    try {
      // Crear la instancia del avatar con el token
      avatar = new StreamingAvatar({ token });

      // Configurar e iniciar el avatar
      sessionData = await avatar.createStartAvatar({
        quality: AvatarQuality.High,
        avatarName: "ef08039a41354ed5a20565db899373f3",
        voice: {
          voiceId: "28f7220adbc144eeba42d70e1e969b29",
          rate: 1.5,
          emotion: VoiceEmotion.FRIENDLY,
        },
        language: "Spanish",
      });

      if (!sessionData.session_id && !sessionData.url) {
        throw new Error("La respuesta no incluye un session_id ni una URL de video.");
      }

      console.log("Datos de la sesión del avatar:", sessionData);
      avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
    } catch (error) {
      console.error("Error al iniciar la sesión de streaming:", error);
      throw error;
    }
  }

  // Manejar evento cuando el stream del avatar esté listo
  const videoRef = useRef<HTMLVideoElement>(null);

  function handleStreamReady(event: CustomEvent) {
    console.log("Stream está listo:", event);

    if (event.detail) {
      const stream = event.detail; // El MediaStream
      console.log("Stream recibido:", stream);
      //fetchAccessTexto();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((error) => {
            console.error("Error al reproducir el video:", error);
          });
        };
      } else {
        console.error("Elemento de video no disponible.");
      }
    } else {
      console.error("Stream no está disponible.");
    }
  }

  //funcion para conectar
  const connectConversation = useCallback(async () => {
    try {
      // 1. Obtener el token
      const token = await fetchAccessToken();

      // 2. Usar el token para crear la sesión de streaming
      await createStreamingSession(token);

      // Configurar el cliente de OpenAI y otros elementos necesarios
      const client = clientRef.current;
      const wavRecorder = wavRecorderRef.current;

      setIsConversationEnded(false);
      setIsConnected(true);
      startTimeRef.current = new Date().toISOString();
      setRealtimeEvents([]);
      setItems(client.conversation.getItems());

      await wavRecorder.begin();
      await client.connect();

      // Activa el modo "En vivo"
      await enableLiveMode();

      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Hello!`,
        },
      ]);
    } catch (error) {
      console.error("Error al conectar la conversación o iniciar el avatar:", error);
    }
  }, []);

  /**
   * Desconectar la conversación y mostrar el video
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);

    // Cierra la conexión de Heygen
    if (videoRef?.current) {
      videoRef.current.srcObject = null;
    }

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    // Generar transcripción completa
    const fullTranscription = items
      .map((item) => item.formatted.transcript)
      .filter(Boolean)
      .join('\n');

    // Llamar a la función para generar el informe y esperar que se complete
    const generatedReport = await generateReport(fullTranscription);

    // Crear el contenido combinado
    const combinedContent = `
                INFORME DE LA ENTREVISTA
                ------------------------
               ${generatedReport || 'No se pudo generar el informe.'}
  
                TRANSCRIPCIÓN COMPLETA
                -----------------------
               ${fullTranscription || 'No hay transcripción disponible.'}
                `;
    // Descargar el informe automáticamente
    downloadReport(combinedContent, 'Informe_Entrevista_Completo.txt');

    setIsConversationEnded(true); // Mostrar video de despedida
  }, [avatar, items, sessionData]);


  /**
   * Switch between Manual <> VAD mode for communication
   */
  const enableLiveMode = async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    // Configura siempre en "En vivo"
    client.updateSession({
      turn_detection: { type: 'server_vad' },
    });

    if (client.isConnected() && wavRecorder.getStatus() !== 'recording') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  };


  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#A000EB',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );
    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
    });

    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();

      // Detecta si hay actividad de voz del usuario
      if (item.role === 'user' && delta?.transcription) {
        const userSpeech = delta.transcription.text.trim();
        console.log("Texto del usuario:", userSpeech);

        // Si el avatar está hablando, interrúmpelo
        if (userSpeech && avatar) {
          try {
            console.log("Intentando interrumpir al avatar con session_id:", sessionData?.session_id);
            await fetchInterrupTexto();
            console.log("Interrupción realizada exitosamente.");
          } catch (error) {
            console.error("Error al intentar interrumpir al avatar:", error);
          }
        }
      }

      // Procesa mensajes del asistente cuando estén completos
      if (item.role === 'assistant' && item.status === 'completed' && item.formatted?.transcript) {
        const assistantText = item.formatted.transcript.trim(); // Extrae el texto formateado

        try {
          if (avatar && assistantText) {
            await avatar.speak({
              text: assistantText,
              task_type: TaskType.REPEAT,
            });
            console.log("Texto enviado al avatar:", assistantText);
          }
        } catch (error) {
          console.error("Error al enviar el texto al avatar:", error);
        }
      }

      setItems(items);
    });


    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/SEO-COLORES-04 (1).png" />
          <span className='titulo'>Entrevista Seo Contenidos</span>
        </div>
      </div>

      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <article /*style="width: fit-content"*/>
              <video ref={videoRef} id="avatarVideo" playsInline autoPlay></video>

            </article>
            {report && (
              <div className="report-section">
                <h2>Informe de la Entrevista</h2>
                <p>{report}</p>
              </div>
            )}

          </div>
          <div className="content-actions">
            <div className="status">En vivo</div> {/* Indica el estado */}
            {/*<Button label="Descargar transcripción" onClick={downloadTranscription} />*/}
            <Button
              label={isConnected ? 'Desconectar' : 'Conectar'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={isConnected ? disconnectConversation : connectConversation}
            />
          </div>
        </div>
      </div>
    </div >
  );
}