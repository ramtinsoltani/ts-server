# TypeScript Server Infrastructure/Template

This repository contains a Node.js server infrastructure/template ready for use with the following properties:

  - TypeScript enabled
  - Powered by Express
  - Automatic code minification
  - Logic is encapsulated into "Services" and router middlewares are grouped as "Routers"
  - Routes are easily defined inside the Router decorator
  - Super easy input validation on routers (body input, headers, query parameters, etc.)
  - Ability to extend the validation logic with custom validators
  - Dynamic route and service installation
  - Dynamic service injection without circular dependency issues

The purpose of this repository is mainly reusability and a kick start to developing backend solutions with TypeScript.

# Installation

  1. Clone this repo
  2. `npm install`
  3. That's it!

# NPM Scripts

  - `npm run build`: Build the server into `dist`.
  - `npm run launch`: Runs the last build.
  - `npm run start`: Builds and runs the server.

# Development

All the components of this server infrastructure are divided into two categories: Services and Routers.

## Services

A service is basically a singleton class which is shared and accessible throughout the whole app (really similar to Angular singleton/global services).

To build a service, simply create a file with the extension `.service.ts` anywhere inside the `src` directory and decorate it using the `@Service` decorator as shown below:

```ts
// all imports are from src/core.ts
import { Service } from './core';

@Service({
  name: 'foo'
})
export class FooService {

  log() {
    console.log('Foo service!');
  }

}
```

This file will be automatically picked up by the server, so there's no need for any installation. You can then inject these services into your routers and also into other services, as shown below:

```ts
import { Service, OnInjection } from './core';
import { FooService } from './foo.service'; // For typings

@Service({
  name: 'bar'
})
export class BarService implements OnInjection {

  private foo: FooService;

  // Inject the service
  onInjection(services: any) {
    this.foo = services.foo;
    this.foo.log(); // Logs: Foo service!
  }

}
```

## Routers

Similar to services, you can build a router by creating a file with the extension `.router.ts` stored anywhere inside the `src` directory. The `@Router` decorator is then used to decorate the class as a router while providing route definitions and other metadata.

```ts
import { Router, OnInjection } from './core';
import { BarService } from './bar.service';

@Router({
  name: 'router1'
})
export class Router1 implements OnInjection {

  private bar: BarService;

  onInjection(services: any) {
    this.bar = services.bar;
  }

}
```

### Defining Routes

The `@Router` decorator accepts the following properties:

| Key | Type | Description |
|:----|:----:|:------------|
| name | string | The name of the router (only used for logging). |
| priority | number | Routers are sorted by priority before mounting their middleware in the Express stack (defaults to `0`). |
| routes | Array<RouteDefinition> | An array of route definitions. |

The `RouteDefinition` interface is as follows:

| Key | Type | Required | Description |
|:----|:----:|:--------:|:------------|
| path | string | Yes | The path of the route (identical to app.use(**path**)). |
| handler | string | Yes | The name of the route handler function (must exist in the router class). |
| method | RouteMethod | No | The HTTP method of the route. If not provided, the route will cover all methods (global). |
| validate | Array<ValidationRule> | No | Used to easily install validators for validating input (body, header, etc.) |

The following is an example of a simple router which defines the route `GET /test` linked to the `Router1.routeHandler1` route handler:

```ts
import { Router, RouteMethod } from './core';
import { Request, Response, NextFunction } from 'express';

@Router({
  name: 'router1',
  routes: [
    { path: '/test', method: RouteMethod.GET, handler: 'routeHandler1' }
  ]
})
export class Router1 {

  routeHandler1(req: Request, res: Response) {
    res.status(200).send('OK');
  }

}
```

### Input Validation

There are four types of validation in routers: Headers, Query Parameters, Body (only JSON and urlencoded), and custom validation:

  1. `header({ name: value, ... })`: With header validation you can check if headers are present and set with the required value.
  2. `query(['paramName', ...])`: The query parameters validator can only check the presence of the query input.
  3. `body({ key: ValidatorFunction })`: Body validators can create complex validation with ease by combining different logic on each key validation.
  4. `custom(ValidatorFunction)`: If none of the above fit your needs, you can always take control!

> Note: You can stack multiple validators of the same kind inside the `validate` array.

When validation is used, the requests that won't pass the validation will automatically get rejected with a validation error.

#### Header Validation Example

```ts
import { Router, RouteMethod, header } from './core';

@Router({
  name: 'router1',
  priority: 100,
  routes: [
    { path: '/postdata', handler: 'postHandler', method: RouteMethod.POST, validate: [
      header({ 'content-type': 'application/json' })
    ]}
  ]
})
export class Router1 {

  postHandler(req, res) {

    // req.body is ensured to be valid JSON

  }

}
```

#### Query Parameter Validation Example

```ts
import { Router, query } from './core';

@Router({
  name: 'router1',
  priority: 100,
  routes: [
    { path: '*', handler: 'authHandler', validate: [
      query(['token'])
    ]}
  ]
})
export class Router1 {

  authHandler(req, res) {

    // req.query.token is definitely provided

  }

}
```

#### Body Validation Example

Now let's get crazy! Let's write a validator which requires the following JSON body:

| Key | Requirement |
|:----|:------------|
| title | Must be present and a valid string. |
| authors | Must be present and a valid array of strings with at least one entry. |
| co-authors | Optional, but if present, it has the same requirement as `authors` but all entries must be prefixed with `co-`! |
| release | A namespace. |
| release.year | Must be a valid number between `2000` and `2019`. |
| release.sells | Must be a valid number. |
| price | Cannot be a boolean. |

```ts
import {
  Router,
  RouteMethod,
  body,
  type,
  len,
  opt,
  and,
  match,
  not
} from './core';

@Router({
  name: 'router1',
  priority: 100,
  routes: [
    { path: '/book/new', handler: 'newBook', method: RouteMethod.POST, validate: [
      body({
        title: type.string,
        authors: type.array(type.string, len.min(1)),
        'co-authors': opt(type.array(and(type.string, match(/^co-.+$/))), len.min(1)),
        release: {
          year: and(type.number, range(2000, 2019)),
          sells: type.number
        },
        price: not(type.boolean)
      })
    ]}
  ]
})
export class Router1 {

  newBook(req, res) {

    // req.body has passed the validation test

  }

}
```

#### Custom Validation

If you need to do something more complex or unique and still want to benefit from reusability and the auto-respond feature of the validators, you can create a function with this signature `(req: Request) => boolean` and pass it to the `custom` method:

```ts
import { Router, RouteMethod, custom } from './core';
import { Request } from 'express';

@Router({
  name: 'auth',
  priority: 100,
  routes: [
    { path: '*', handler: 'authHandler', validate: [
      custom(basicAuthValidator)
    ]}
  ]
})
export class Router1 {

  authHandler(req, res, next) {

    // Do basic auth
    next();

  }

}

// Making sure basic authentication credentials are provided
function basicAuthValidator(req: Request): boolean {

  const authorization = req.header('Authorization');

  return authorization && authorization.substr(0, 5) === 'Basic';

}
```

## Server Config

The server has a configuration file located at `src/config.json` with the following settings:

| Key | Type | Description |
|:----|:----:|:------------|
| port | number | The port number to launch the server on (defaults to `5000`). |
| verboseLogs | boolean | Shows startup logs and route-specific logs (defaults to `true`). |

### Config Expansion

You can expand the config object typing by editing the `ServerConfig` model inside `src/models.ts`.

### Config Injection

If you need to get access to the config object inside your services or routers, implement `OnConfig` on your classes and define the following function:

```ts
import { OnConfig, ServerConfig } from './core';

class implements OnConfig {

  onConfig(config: ServerConfig) {
    // Inject or use...
  }

}
```

## Server Error

The `ServerError` class is available for responding to users with errors through the REST API and is used by the server internally when rejecting requests (e.g. validation errors, internal errors, 404 errors, etc.). Use the following example as how to interact with the `ServerError` class:

```ts
import { ServerError } from './core';

const error = new ServerError('Message', 'ERROR_CODE'); // Code defaults to 'UNKNOWN_ERROR' when not provided

// res.json(error) --> { error: true, message: 'Message', code: 'ERROR_CODE' }
```

> Note that this class is not an actual extension of the Error class and should not be used when stack trace is needed.

# Notes

  - You can see some more detailed examples inside the sample files in `services` and `routers` directories.
  - The directory structure of the server is totally up to you, since the server scans the `src` for `.service.js` and `.router.js` files to install at any depth.
  - You can make your validators modular by storing the validator functions and the validator body definitions inside other files and reuse them everywhere.
  -