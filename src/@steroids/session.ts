import { Request, Response, NextFunction } from './models';

export class ServerSessionManager {

  protected __handlers: SessionHandlers = {};

  /**
  * Assigns a handler to a session event.
  * @param event A session event name.
  * @param handler An event handler.
  */
  public on(event: 'created', handler: SessionHandlers['created']): this;
  public on(event: 'claims:get', handler: SessionHandlers['claimsGet']): this;
  public on(event: 'claims:set', handler: SessionHandlers['claimsSet']): this;
  public on(event: string, handler: (...args: any[]) => any|Promise<any>): this {

    if ( ! ['created', 'claims:get', 'claims:set'].includes(event) ) {

      log.error(`Event '${event}' does not exist on session!`);
      return this;

    }

    if ( this.__handlers[event] ) {

      log.error(`Session's '${event}' event has already been assigned a handler!`);
      return this;

    }

    this.__handlers[event] = handler;

    return this;

  }

  /**
  * Sets a session claim using a pre-assigned handler.
  * @param id A session ID.
  * @param key A claim key.
  * @param value A claim value.
  */
  public setClaim(id: string, key: string, value: any): void|Promise<void> {

    if ( ! this.__handlers.claimsSet ) {

      log.warn(`Session event 'claims:set' has no handler assigned!`);
      return;

    }

    return this.__handlers.claimsSet(id, key, value);

  }

  /**
  * Retreives a claim using a pre-assigned handler.
  * @param id A session ID.
  * @param key A claim key.
  */
  public getClaim(id: string, key: string): any|Promise<any> {

    if ( ! this.__handlers.claimsSet ) {

      log.warn(`Session event 'claims:get' has no handler assigned!`);
      return;

    }

    return this.__handlers.claimsGet(id, key);

  }

}

export class ServerSessionManagerInternal extends ServerSessionManager {

  constructor(
    private __signed: boolean
  ) {

    super();

  }

  private __generateSessionId(): string {

    const charset = 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM0123456789';
    let id: string = '';

    for ( let i = 0; i < 20; i++ ) {

      id += charset[Math.floor(Math.random() * charset.length)];

    }

    return id;

  }

  public middleware(req: Request, res: Response, next: NextFunction) {

    const cookies = this.__signed ? req.signedCookies : req.cookies;

    // Extract session ID
    if ( cookies.sessionId ) {

      req.sessionId = cookies.sessionId;

      next();

    }
    // Generate new session ID
    else {

      req.sessionId = this.__generateSessionId();

      res.cookie('sessionId', req.sessionId, { signed: this.__signed });

      // Run created handler
      (async () => await this.__handlers?.created(req.sessionId))()
      .catch(error => {

        log.error(`Session's created event threw an error!`, error);

      })
      .finally(() => next());

    }

  }

}

interface SessionHandlers {

  created?: (id: string) => void|Promise<void>;
  claimsGet?: (id: string, key: string) => any|Promise<any>;
  claimsSet?: (id: string, key: string, value: any) => void|Promise<void>;

}