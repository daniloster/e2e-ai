// Reviewed by: developer (pending native es review)
import type { enGB } from './en-GB';

export const es: Readonly<Record<keyof typeof enGB, string>> = {
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.back': 'Volver',
  'common.loading': 'Cargando',
  'common.linkErrorTitle': 'No se pudo abrir el enlace',
  'common.linkInvalid': 'Este enlace está dañado o incompleto. Pide uno nuevo.',
  'common.linkUnsupported':
    'Este enlace necesita una versión más reciente de Pocket Notes. Actualiza la app e inténtalo de nuevo.',

  'home.tagline': 'Excava el tablero, bloque a bloque.',
  'home.play': 'Jugar',
  'home.settings': 'Ajustes',
  'home.best': 'Mejor puntuación: {score}',
  'home.noBest': 'Aún sin puntuación',

  'play.title': 'Tablero',
  'play.dig': 'Excavar',
  'play.digA11y_one': 'Excavar {count} bloque',
  'play.digA11y_other': 'Excavar {count} bloques',
  'play.blocksLeft_zero': 'No quedan bloques',
  'play.blocksLeft_one': 'Queda {count} bloque',
  'play.blocksLeft_other': 'Quedan {count} bloques',
  'play.score': 'Puntos {score}',
  'play.moves': 'Movimientos {moves}',
  'play.strength': 'Fuerza',
  'play.strengthOption': 'Fuerza {count}',
  'play.cleared': '¡Tablero despejado en {moves} movimientos!',
  'play.newBest': '¡Nueva mejor puntuación!',
  'play.undo': 'Deshacer',
  'play.again': 'Jugar otra vez',
  'play.share': 'Compartir tablero',
  'play.shareMessage': '¿Puedes despejar este tablero en Pocket Notes? {link}',
  'play.shareFailed': 'No se pudo compartir. Inténtalo de nuevo.',

  'settings.title': 'Ajustes',
  'settings.privacy': 'Privacidad',
  'settings.analytics': 'Estadísticas de uso',
  'settings.analyticsHint':
    'Las estadísticas de uso anónimas y los informes de errores nos ayudan a corregir problemas. No se envía nada sin tu permiso.',
  'settings.player': 'Jugador',
  'settings.playerId': 'ID de jugador',
  'settings.testBuild':
    'Versión de prueba: este ID de jugador es distinto del de la versión de la tienda.',
  'settings.version': 'Versión {version}',

  'consent.title': 'Ayúdanos a mejorar Pocket Notes',
  'consent.description':
    '¿Podemos recoger estadísticas de uso anónimas e informes de errores? Nunca incluyen nada de lo que escribes. Puedes cambiarlo en Ajustes cuando quieras.',
  'consent.allow': 'Permitir',
  'consent.decline': 'No, gracias',

  'notes.open': 'Mis notas',
  'notes.signInTitle': 'Inicia sesión en tus notas',
  'notes.email': 'Correo',
  'notes.password': 'Contraseña',
  'notes.signIn': 'Entrar',
  'notes.signInFailed': 'Correo o contraseña incorrectos.',
  'notes.title': 'Mis notas',
  'notes.signedInAs': 'Sesión iniciada como {email}',
  'notes.newLabel': 'Nueva nota',
  'notes.newPlaceholder': '¿Qué necesitas recordar?',
  'notes.add': 'Añadir nota',
  'notes.empty': 'Aún no hay notas. Añade la primera.',
  'notes.count_one': '{count} nota',
  'notes.count_other': '{count} notas',
  'notes.deleteA11y': 'Eliminar {title}',
  'notes.signOut': 'Salir',
  'notes.loadFailed': 'No se pudieron cargar las notas. Inténtalo de nuevo.',

  'app.name': 'Pocket Notes',
};
