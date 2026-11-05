import { Component } from '@angular/core';
import { Toolbar } from '../../utils/toolbar/toolbar';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [Toolbar, RouterOutlet],
  selector: 'app-content',
  templateUrl: './content.html',
})
export class Content {}
